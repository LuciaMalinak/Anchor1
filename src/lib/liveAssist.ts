import Anthropic from "@anthropic-ai/sdk";

// Same pattern as summarize.ts, but conversational rather than
// tool-forced structured output: this is "Ask Anchor" during a live
// meeting, so it just needs a short, grounded answer in plain text.
// Latency matters more than anywhere else in the app here — someone's
// mid-conversation waiting on this — so it deliberately runs on the
// fastest current model rather than the more capable one summarize.ts
// and the other, non-real-time features use. Override with
// ANTHROPIC_MODEL if that trade-off ever needs to move the other way.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and add it to .env.local"
    );
  }
  return new Anthropic({ apiKey });
}

export type DealContext = {
  dealName: string;
  // Both can come from a connected CRM sync (e.g. Salesforce) as well as
  // being set directly in Anchor — either way, worth grounding answers in.
  stage: string | null;
  companyWebsite: string | null;
  memory: string | null;
  continuityNote: string | null;
  // What the rep typed in "Before" prep (deals.notes) and any hard
  // constraints they've set (deals.decisionBoundaries) — already fed into
  // live coaching (see liveCoaching.ts); Ask Anchor didn't have either
  // until now, so a mid-meeting question could miss something the rep
  // explicitly wrote down going in.
  notes: string | null;
  decisionBoundaries: string | null;
  // The tail end of THIS call's own live transcript, if one is actually
  // in progress right now (see meetingLiveSegments / the live route) —
  // separate from recentMeetings below, which are only past, FINISHED
  // meetings. Without this, a mid-call question like "what did they just
  // say about pricing" had no way to be answered — Ask Anchor could only
  // reason from what was already synthesized after past calls ended.
  // Null whenever no meeting on this deal is currently live.
  liveTranscript: string | null;
  people: { name: string; role: string | null; company: string | null; relationshipSummary: string | null }[];
  recentMeetings: {
    title: string;
    occurredAt: string;
    overview: string;
    keyPoints: string[];
    actionItems: { text: string; owner: string | null }[];
    // Buying signals / risks / blockers the AI flagged after that meeting
    // (summaries.dealSignals) — previously fetched by the caller and then
    // silently dropped before reaching the model.
    dealSignals: { type: "buying_signal" | "risk" | "blocker"; detail: string }[];
  }[];
  // isImage files never have an excerpt (no text is ever extracted from
  // them) but ARE readable by Anchor — via the images array below, not
  // via this text block. buildContextBlock() uses isImage to say so
  // correctly instead of claiming the file can't be seen at all.
  files: { fileName: string; excerpt: string | null; isImage?: boolean }[];
  companyResearch: string | null;
  newsHeadline: string | null;
  // Recent Gmail/Calendar activity with this deal's contacts, when the
  // deal's lead has Google connected (see src/lib/dealIntegrationContext.ts).
  // Null whenever there's no connection or nothing matched — never invented.
  emailContext: string | null;
  calendarContext: string | null;
  // How the deal's actual lead tends to negotiate, decide, and
  // communicate (see src/lib/styleProfile.ts) — null if no lead is set,
  // or there isn't enough of their own material yet to say anything real.
  // Present so a delegate covering this deal's meeting gets answers that
  // sound like the lead would give them, not a generic assistant voice.
  dealLeadStyle: string | null;
};

function buildContextBlock(ctx: DealContext): string {
  const parts: string[] = [`Deal: ${ctx.dealName}`];
  if (ctx.stage) parts.push(`Stage: ${ctx.stage}`);
  if (ctx.companyWebsite) parts.push(`Company website: ${ctx.companyWebsite}`);

  if (ctx.memory) {
    parts.push(`\nWhat Anchor has learned about this deal so far: ${ctx.memory}`);
  }

  if (ctx.continuityNote) {
    parts.push(`\nGoing in, remember: ${ctx.continuityNote}`);
  }

  if (ctx.notes) {
    parts.push(`\nThe rep's own prep notes for this deal: ${ctx.notes}`);
  }

  if (ctx.decisionBoundaries) {
    parts.push(`\nDecision boundaries / constraints for this deal: ${ctx.decisionBoundaries}`);
  }

  if (ctx.liveTranscript) {
    parts.push(
      `\nThe most recent portion of THIS call's own live transcript (it's happening right now — answer questions about "what did they just say" from this, not from past meetings):\n${ctx.liveTranscript}`
    );
  }

  if (ctx.people.length > 0) {
    parts.push("\nPeople on this deal:");
    for (const p of ctx.people) {
      const roleCompany = [p.role, p.company].filter(Boolean).join(", ");
      parts.push(`— ${p.name}${roleCompany ? ` (${roleCompany})` : ""}`);
      if (p.relationshipSummary) parts.push(`  ${p.relationshipSummary}`);
    }
  }

  if (ctx.recentMeetings.length > 0) {
    parts.push("\nPast meetings on this deal (most recent first):");
    for (const m of ctx.recentMeetings) {
      parts.push(`\n— ${m.title} (${m.occurredAt})`);
      parts.push(m.overview);
      if (m.keyPoints.length > 0) {
        parts.push("Key points: " + m.keyPoints.join("; "));
      }
      if (m.actionItems.length > 0) {
        parts.push(
          "Action items: " +
            m.actionItems.map((a) => a.text + (a.owner ? ` (${a.owner})` : "")).join("; ")
        );
      }
      if (m.dealSignals.length > 0) {
        parts.push(
          "Flagged at the time: " +
            m.dealSignals.map((s) => `[${s.type.replace("_", " ")}] ${s.detail}`).join("; ")
        );
      }
    }
  } else {
    parts.push("\nNo finished meetings on this deal yet.");
  }

  if (ctx.files.length > 0) {
    // Deliberately explicit about WHY the model has this content, not
    // just what it is — models have a strong trained reflex to say "I
    // can't open .pptx/.xlsx files" the instant they see that extension
    // in a filename, even when the actual text is sitting right there in
    // the prompt. Naming that reflex directly and telling it what to do
    // instead is the fix; a plain "here are the files" header wasn't
    // enough to stop a real case of exactly this happening.
    parts.push(
      "\nFiles attached to this deal — Anchor already extracted the text below from each one at upload time, including from PowerPoint and Excel files. That text IS your access to the file: never tell the person you can't open, read, or access a file type when its content is shown below — just use it directly, the same as any other context here. Only say a file isn't readable when it's explicitly marked that way below."
    );
    for (const f of ctx.files) {
      if (f.excerpt) {
        // Keep each file's slice of the prompt bounded — this is a quick
        // mid-meeting answer, not a document Q&A tool, so a representative
        // excerpt is enough; the full file is still one click away.
        const excerpt = f.excerpt.length > 2000 ? f.excerpt.slice(0, 2000) + "…" : f.excerpt;
        parts.push(`\n— ${f.fileName} — extracted content:\n${excerpt}`);
      } else if (f.isImage) {
        parts.push(`\n— ${f.fileName} (an image — shown to you directly below, if it made the cut)`);
      } else {
        parts.push(`\n— ${f.fileName} (not a readable format — genuinely can't see its contents, unlike the files above)`);
      }
    }
  }

  if (ctx.newsHeadline || ctx.companyResearch) {
    parts.push("\nRecent news and public info Anchor already gathered on this company (also shown live in the room right now, so treat it as something the person you're helping can already see):");
    if (ctx.newsHeadline) parts.push(ctx.newsHeadline);
    if (ctx.companyResearch) parts.push(ctx.companyResearch);
  }

  if (ctx.emailContext) {
    parts.push(`\nRecent emails with people on this deal:\n${ctx.emailContext}`);
  }

  if (ctx.calendarContext) {
    parts.push(`\nRecent and upcoming calendar meetings with people on this deal:\n${ctx.calendarContext}`);
  }

  if (ctx.dealLeadStyle) {
    parts.push(
      `\nHow the person who actually leads this deal tends to operate — match this instinct, not a generic tone, especially if you're helping someone covering for them: ${ctx.dealLeadStyle}`
    );
  }

  return parts.join("\n");
}

// Shared by askAnchor and askAnchorStream so the two never drift — they
// need byte-identical prompts since they're the same feature, just
// streamed vs. not.
function buildSystemPrompt(contextBlock: string): string {
  return `You are Anchor, a live meeting assistant. Someone is in the middle of a real meeting right now and typed you a quick question — they need a short, useful, immediately usable answer, not a lecture.

Ground every answer in the deal context you're given below (past meeting summaries, action items, flagged signals, continuity notes, the rep's own prep notes and decision boundaries, attached file contents) first. You also have a live web search tool — reach for it when the question needs something current that wouldn't be in the deal context: recent company news, funding, industry trends, competitor moves, market conditions. Only search about the company/industry, never to look up a named individual.

Attached files, including PowerPoint and Excel ones, are already converted to plain text before you ever see them — when a file's extracted content is shown in the deal context below, treat it exactly like any other text here and answer from it directly. Do not tell the person you're unable to open, read, or access a file because of its format (.pptx, .xlsx, etc.) — that's never true here, and saying it wastes their time mid-meeting. If a specific detail genuinely isn't in what was extracted, say that plainly instead ("that deck doesn't mention X") rather than claiming you can't read the file at all.

If neither the deal context nor a search turns up a real answer, say plainly that Anchor doesn't have that yet and it'll circle back on it next meeting — never invent facts, numbers, names, or commitments. The same applies even when you DO have enough to say something, if answering definitively would mean committing to something risky to state on the rep's behalf right now — a legal term, a contractual commitment, a firm price or discount, a compliance or regulatory claim, anything that should really come from the actual deal lead or a lawyer rather than from you mid-meeting. In that case, say so plainly and that it's worth circling back on next meeting instead of answering as if it's settled.

Keep answers to 2-4 sentences unless the question clearly calls for a short list. Write like you're quietly feeding them a talking point mid-meeting, not writing a report.

--- Deal context ---
${contextBlock}`;
}

// A deal image attached as a real vision content block — see
// buildQuestionContent() below for how these get folded into the actual
// question turn.
export type AnchorImage = { fileName: string; mediaType: string; base64: string };

// The question always ends up as the final user turn's content. Plain
// string when there's nothing to look at (the overwhelmingly common
// case, and identical to the shape this always sent before images
// existed); an array of image blocks followed by the question text when
// the assist route decided one or more attached images were worth
// showing. Images go right next to the question they're answering,
// rather than e.g. their own separate turn, so the model doesn't have to
// guess which past image a follow-up question refers to.
function buildQuestionContent(
  question: string,
  images: AnchorImage[]
): string | Anthropic.MessageParam["content"] {
  if (images.length === 0) return question;
  return [
    ...images.map((img) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: img.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: img.base64 },
    })),
    { type: "text" as const, text: question },
  ];
}

export async function askAnchor(params: {
  context: DealContext;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  images?: AnchorImage[];
}): Promise<string> {
  const contextBlock = buildContextBlock(params.context);

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    system: buildSystemPrompt(contextBlock),
    messages: [
      ...params.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: buildQuestionContent(params.question, params.images ?? []) },
    ],
  });

  // With web search in play, the reply can be split across several text
  // blocks interleaved with citations — join them into one flowing answer
  // rather than only reading the first block (see companyResearch.ts).
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    throw new Error("Anchor didn't return an answer.");
  }
  return text;
}

// Streaming twin of askAnchor, used by the live "During a call" panel —
// the whole point of that surface is speed, and the biggest lever for
// how FAST an answer feels isn't the model (already the fastest one) but
// whether the first words show up in a few hundred ms instead of waiting
// for the complete 2-4 sentence answer (which can take several seconds
// once the model reaches for web search). Yields plain text chunks as
// they arrive; the caller is responsible for concatenating them.
export async function* askAnchorStream(params: {
  context: DealContext;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  images?: AnchorImage[];
}): AsyncGenerator<string> {
  const contextBlock = buildContextBlock(params.context);

  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    system: buildSystemPrompt(contextBlock),
    messages: [
      ...params.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: buildQuestionContent(params.question, params.images ?? []) },
    ],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }

  // Surfaces stream-level errors (e.g. an API error mid-response) that a
  // plain `for await` over content_block_delta events alone would swallow.
  await stream.finalMessage();
}
