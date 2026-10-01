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
  documentContext?: string | null;
  // How the deal's actual lead tends to negotiate, decide, and
  // communicate (see src/lib/styleProfile.ts) — null if no lead is set,
  // or there isn't enough of their own material yet to say anything real.
  // Present so a delegate covering this deal's meeting gets answers that
  // sound like the lead would give them, not a generic assistant voice.
  dealLeadStyle: string | null;
  // Who leads the deal, so answers can be framed the way they'd play it.
  dealLeadName?: string | null;
  // Passages from this deal's own calls, documents and emails that best
  // match the question (see askRetrieval.ts) — searched in full, unlike
  // the summaries and file excerpts below.
  relevantPassages?: string | null;
};

function buildContextBlock(ctx: DealContext): string {
  const parts: string[] = [`Deal: ${ctx.dealName}`];
  if (ctx.stage) parts.push(`Stage: ${ctx.stage}`);
  if (ctx.dealLeadName) parts.push(`Deal lead: ${ctx.dealLeadName}`);

  if (ctx.relevantPassages) {
    parts.push(
      `\nPassages from this deal's own calls, documents and emails that match the question (each labelled with where it's from; call lines start with [minutes:seconds]):\n${ctx.relevantPassages}`
    );
  }
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

  if (ctx.documentContext) {
    parts.push(`\nDocuments about this deal from Google Drive / Dropbox (newest first):\n${ctx.documentContext}`);
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

export type AskMode = "live" | "panel";

// How Anchor looks for an answer and what it suggests — shared by the
// deal assistant and the workspace-wide one so the two never drift.
function sourcingRules(material: string): string {
  return `Answer whatever the person asks — about this work or anything else — and always give them a useful answer. Work through these in order:
1. ${material} When it answers the question, use it first and say exactly where it came from (which call and when — quote the line if it matters — which document, the emails).
2. If that doesn't fully answer it, use web search: companies, markets, competitors, pricing benchmarks, regulations, how-tos, general facts — anything public. Say what you found and name the site. For people, only public professional information (their role, company, public statements) — never their private life.
3. If neither covers it, answer from your own knowledge and say so plainly ("not in your deal data or online — from general knowledge: …").
Never invent anything about the deal itself: what someone said, prices, discounts, dates, commitments and names must come from the material or a source you name. If a deal-specific fact isn't known, say what's missing and how to find it, then still give the best answer you can.`;
}

function leadRules(leadName: string | null | undefined, leadStyle: string | null | undefined): string {
  const who = leadName ? `the deal lead, ${leadName}` : "the deal lead";
  return `Think like ${who}: frame the answer and the suggestions the way they would play this — how they negotiate, what they hold firm on, where they stay flexible, and their tone. ${
    leadStyle
      ? `What Anchor has learned about how they operate: ${leadStyle}`
      : "Anchor hasn't learned much about how they operate yet, so infer it from how this deal has been run so far (their notes, decision limits, and what they said and agreed on calls)."
  }
If the question touches something that should come from them in person — a firm price or discount, a contract or legal term, a compliance claim — still say what they would most likely answer, but mark it as needing their confirmation, and respect any decision limits they've set.`;
}

function formatRules(mode: AskMode): string {
  return mode === "live"
    ? `They're in a live call and glanced at you. Reply in 2-4 sentences they can say or use right now, then one line starting "Next:" with the single best move, then one short line starting "Source:" (e.g. "Source: call on Sep 29" or "Source: web, reuters.com").`
    : `Reply in this shape, with no other headings:
- The answer first: a short paragraph, or a few "- " bullets if listing things.
- Then a line starting "Sources:" naming what you used, e.g. "Sources: call with Jordan, Sep 29 · pricing.xlsx · web: gartner.com".
- Then a line "**Suggested next steps**" followed by 1-3 "- " bullets: concrete moves, in the order you'd make them, phrased the way the lead would do it.
Use **bold** sparingly for names.`;
}

function buildSystemPrompt(contextBlock: string, mode: AskMode, ctx: DealContext): string {
  return `You are Anchor, the assistant for the team working on "${ctx.dealName}"${mode === "live" ? ", answering a quick question during a live call" : ""}.

${sourcingRules("This deal's own material below: first the passages matched to this question from its calls, documents and emails, then the live call (if one is happening), past meeting summaries, notes, files, and email and calendar context.")}

Attached files, including PowerPoint and Excel ones, are already converted to plain text before you ever see them — treat their content like any other text here. Never say you can't open or read a file because of its format.

${leadRules(ctx.dealLeadName, ctx.dealLeadStyle)}

${formatRules(mode)}

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

// What to tell the person when an answer can't be produced at all (after
// the web-search retry), so a dead key, empty credit balance or a bad
// model name says so plainly instead of a vague "try again". Shown in the
// Ask Anchor panels; the full error is logged too.
export function describeAnswerError(err: unknown): string {
  if (err instanceof Error && /ANTHROPIC_API_KEY is not set/.test(err.message)) {
    return "Anchor's AI isn't set up on this server yet (ANTHROPIC_API_KEY is missing in Render).";
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return "Anchor's AI key isn't working, so it can't answer right now. Check ANTHROPIC_API_KEY in Render.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return "The AI model Anchor is set to use isn't available. Check ANTHROPIC_MODEL in Render.";
  }
  if (err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503))) {
    return "Anchor's AI is busy right now. Try again in a minute.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    // Anthropic reports an empty balance as a 400 whose message names it;
    // there's no dedicated error class for it.
    if (/credit balance/i.test(err.message)) {
      return "Anchor's Anthropic account is out of credits, so it can't answer. Add credits at console.anthropic.com → Billing.";
    }
    return `Anchor couldn't answer that (the AI rejected the request: ${err.message.slice(0, 160)}).`;
  }
  if (err instanceof Anthropic.APIError) {
    return `Anchor couldn't finish answering that (AI error ${err.status ?? "unknown"}). Try again in a moment.`;
  }
  return "Anchor couldn't finish answering that. Try asking again.";
}

type AnswerStream = ReturnType<ReturnType<typeof client>["messages"]["stream"]>;

function webSearchTool(maxUses: number): Anthropic.Messages.WebSearchTool20250305 {
  return { type: "web_search_20250305", name: "web_search", max_uses: maxUses };
}

// Streams an answer's text. If the request fails before any text has
// arrived (for example web search being unavailable on the account, or a
// web search hiccup), retries once without web search so the person still
// gets an answer from their own Anchor data instead of an error. A failure
// after text has started is passed on, since retrying would repeat it.
async function* streamWithSearchFallback(
  start: (withSearch: boolean) => AnswerStream
): AsyncGenerator<string, Anthropic.Message> {
  let produced = false;
  try {
    const stream = start(true);
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        produced = true;
        yield event.delta.text;
      }
    }
    // Surfaces stream-level errors (e.g. an API error mid-response) that a
    // plain `for await` over content_block_delta events alone would swallow.
    const message: Anthropic.Message = await stream.finalMessage();
    // An action-only reply (a tool call with no text) is a real answer too.
    if (produced || message.content.some((b) => b.type === "tool_use")) return message;
    console.error("[liveAssist] answer with web search came back empty; retrying without it");
  } catch (err) {
    if (produced) throw err;
    console.error("[liveAssist] answer with web search failed; retrying without it:", err);
  }
  const stream = start(false);
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
  return await stream.finalMessage();
}

// What Ask Anchor can actually DO on a deal, beyond answering — it used to
// have no actions at all, so "stop this meeting" got a reply claiming the
// meeting was being stopped while nothing happened. Each tool call is
// passed to the browser as a marker after the answer text, and carried
// out there (see src/lib/askActions.ts) — stopping an in-person recording
// has to happen in the browser tab holding its audio.
export type AskActions = {
  // The meeting live on this deal right now, if any.
  liveMeetingId: string | null;
  files: { fileName: string; url: string }[];
};

function actionTools(actions: AskActions): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];
  if (actions.liveMeetingId) {
    tools.push({
      name: "stop_meeting",
      description:
        "Stop the meeting that's live on this deal right now: ends the in-person recording, or has Anchor's bot leave the Zoom/Teams call (without ending it for anyone else), then writes the meeting up. Use when the person asks to stop, end, finish or wrap up the meeting, call or recording.",
      input_schema: { type: "object", properties: {} },
    });
  }
  if (actions.files.length) {
    tools.push({
      name: "open_file",
      description:
        "Open one of this deal's files for the person in a new tab. Use when they ask to pull up, open, show or bring up a file, document, deck or attachment. Pick the file that best matches what they asked for.",
      input_schema: {
        type: "object",
        properties: {
          file_name: { type: "string", enum: actions.files.map((f) => f.fileName) },
        },
        required: ["file_name"],
      },
    });
  }
  return tools;
}

function actionRules(actions: AskActions): string {
  const can = [
    actions.liveMeetingId ? "stop the live meeting (stop_meeting)" : null,
    actions.files.length ? "open one of this deal's files (open_file)" : null,
  ].filter(Boolean);
  const list = can.length ? `You can ${can.join(" and ")} by calling the tool. ` : "";
  return `\n\nActions: ${list}When the person asks for one of these, call the tool — a short sentence before it is fine — rather than describing how they could do it. Never say you did something (stopped or ended a meeting, opened a file, sent an email, created a task, changed a setting) unless you called a tool for it in this reply; if there's no tool for what they ask, say plainly that you can't do that from here and where in Anchor they can do it.${
    actions.liveMeetingId ? "" : " Nothing is live on this deal right now, so there's no meeting to stop."
  }`;
}

// Turns the model's tool calls into the text the person sees plus the
// action markers askActions.ts carries out.
function* actionOutput(message: Anthropic.Message, actions: AskActions, producedText: boolean): Generator<string> {
  for (const block of message.content) {
    if (block.type !== "tool_use") continue;
    if (block.name === "stop_meeting" && actions.liveMeetingId) {
      if (!producedText) yield "Stopping the meeting now — I'll write it up from what was recorded.";
      yield `\n\n[[anchor:stop:${actions.liveMeetingId}]]`;
    } else if (block.name === "open_file") {
      const name = (block.input as { file_name?: unknown }).file_name;
      const file = actions.files.find((f) => f.fileName === name);
      if (!file) continue;
      yield `${producedText ? "\n\n" : ""}Opening [${file.fileName}](${file.url}).`;
      yield `\n\n[[anchor:open:${file.url}]]`;
    }
  }
}

export async function askAnchor(params: {
  context: DealContext;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  images?: AnchorImage[];
  mode?: AskMode;
}): Promise<string> {
  const contextBlock = buildContextBlock(params.context);
  const mode = params.mode ?? "live";

  const request = (withSearch: boolean) =>
    client().messages.create({
      model: MODEL,
      max_tokens: mode === "live" ? 700 : 1500,
      ...(withSearch ? { tools: [webSearchTool(mode === "live" ? 3 : 5)] } : {}),
      system: buildSystemPrompt(contextBlock, mode, params.context),
      messages: [
        ...params.history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user" as const, content: buildQuestionContent(params.question, params.images ?? []) },
      ],
    });
  // Same safeguard as streamWithSearchFallback: answer without web search
  // rather than not at all.
  const message = await request(true).catch((err) => {
    console.error("[liveAssist] answer with web search failed; retrying without it:", err);
    return request(false);
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
  mode?: AskMode;
  actions?: AskActions;
}): AsyncGenerator<string> {
  const contextBlock = buildContextBlock(params.context);
  const mode = params.mode ?? "live";
  const actions = params.actions ?? { liveMeetingId: null, files: [] };
  const tools = actionTools(actions);

  const message = yield* streamWithSearchFallback((withSearch) =>
    client().messages.stream({
      model: MODEL,
      max_tokens: mode === "live" ? 700 : 1500,
      ...(withSearch || tools.length
        ? { tools: [...(withSearch ? [webSearchTool(mode === "live" ? 3 : 5)] : []), ...tools] }
        : {}),
      system: buildSystemPrompt(contextBlock, mode, params.context) + actionRules(actions),
      messages: [
        ...params.history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user" as const, content: buildQuestionContent(params.question, params.images ?? []) },
      ],
    })
  );
  const producedText = message.content.some((b) => b.type === "text" && b.text.trim().length > 0);
  yield* actionOutput(message, actions, producedText);
}

// The app-wide Ask Anchor panel (see /api/ask and AskAnchorDock.tsx) —
// same model and streaming shape as askAnchorStream, but grounded in a
// whole workspace (every visible deal, recent meetings, tasks, people) or
// in one meeting's recap, instead of a single deal mid-call.
function buildWorkspaceSystemPrompt(
  scope: "workspace" | "meeting",
  contextBlock: string,
  lead: { name: string | null; style: string | null },
  canSearchWeb = true
): string {
  const material =
    scope === "meeting"
      ? "The meeting this person is looking at, below: its summary, action items, signals and full transcript (lines start with [minutes:seconds]), plus passages matched to this question from the deal's other calls, documents and emails."
      : "This person's own Google Calendar (next 36 hours) and Gmail inbox (last 3 days), then their Anchor workspace: passages matched to this question from their deals' calls, documents and emails, their deals, recent meetings, upcoming calls, open tasks and the people they've met. For questions about their day, agenda, schedule or email, answer from the calendar and inbox first: name the meetings with times, and the emails that need a reply (who, what, why it matters), linking them to deals where they relate.";
  return `You are Anchor, an assistant built into a meeting-intelligence app for sales and client teams. The person is asking you a question from inside the app.

${sourcingRules(material)}

${leadRules(lead.name, lead.style)}${scope === "workspace" ? "\nFor a deal someone else leads (each deal lists its lead), frame suggestions the way that lead would." : ""}

Facts about Anchor itself, for questions about the app:
- Google (Gmail + Calendar) connects read-only by default, to keep each deal's email and calendar history current. Anchor only asks for permission to create Gmail drafts or calendar events the first time someone clicks "Save to Gmail drafts" or "Add to calendar", and it never sends an email by itself.
- Slack is used to send deal handoff briefings to a teammate. Salesforce and HubSpot sync contacts and deals into Anchor, and Anchor can suggest field updates after a call that are only written back when the person approves them.
- Anchor Desktop records Zoom and Teams calls on a Mac without a bot joining.

${scope === "workspace" ? quietDayRules(canSearchWeb) + "\n\n" : ""}${formatRules("panel")}

--- Context ---
${contextBlock}`;
}

// For "what needs me today?"-style questions on a day with nothing urgent:
// there is always something worth doing on a deal, so never answer that
// nothing needs attention.
function quietDayRules(canSearchWeb: boolean): string {
  return `When the person asks what needs them, what to work on, or what's happening, and nothing in the context is urgent (no overdue or open tasks, no call today, no deal flagged at risk), never reply that nothing needs them. Suggest the most useful next steps instead, for example:
- Documents on their deals that were recently added or updated: say which and why they're worth a look.
- Deals that have gone quiet (no meeting or email in a while): suggest a check-in, and name the person to contact.
- Upcoming calls in the next few days worth preparing for.
${
  canSearchWeb
    ? "- Recent news that could affect their deals: search the web for the companies behind their most active deals and share one to three relevant articles from the last few weeks, each as a markdown link with one line on why it matters for that deal. Only share articles you actually found; never invent a link."
    : "- News that could affect their deals: suggest checking for recent news on the companies behind their most active deals (web search isn't available for this answer, so don't cite or invent articles)."
}`;
}

export async function* askWorkspaceStream(params: {
  scope: "workspace" | "meeting";
  contextBlock: string;
  lead: { name: string | null; style: string | null };
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
}): AsyncGenerator<string> {
  yield* streamWithSearchFallback((withSearch) =>
    client().messages.stream({
      model: MODEL,
      max_tokens: 1500,
      ...(withSearch ? { tools: [webSearchTool(5)] } : {}),
      system: buildWorkspaceSystemPrompt(params.scope, params.contextBlock, params.lead, withSearch),
      messages: [
        ...params.history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user" as const, content: params.question },
      ],
    })
  );
}
