import Anthropic from "@anthropic-ai/sdk";

// Same pattern as summarize.ts, but conversational rather than
// tool-forced structured output: this is "Ask Anchor" during a live
// meeting, so it just needs a short, grounded answer in plain text.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

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
  memory: string | null;
  continuityNote: string | null;
  recentMeetings: {
    title: string;
    occurredAt: string;
    overview: string;
    keyPoints: string[];
    actionItems: { text: string; owner: string | null }[];
  }[];
  fileNames: string[];
  companyResearch: string | null;
  newsHeadline: string | null;
};

function buildContextBlock(ctx: DealContext): string {
  const parts: string[] = [`Deal: ${ctx.dealName}`];

  if (ctx.memory) {
    parts.push(`\nWhat Anchor has learned about this deal so far: ${ctx.memory}`);
  }

  if (ctx.continuityNote) {
    parts.push(`\nGoing in, remember: ${ctx.continuityNote}`);
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
    }
  } else {
    parts.push("\nNo finished meetings on this deal yet.");
  }

  if (ctx.fileNames.length > 0) {
    parts.push(`\nFiles attached to this deal (names only — contents not available): ${ctx.fileNames.join(", ")}`);
  }

  if (ctx.newsHeadline || ctx.companyResearch) {
    parts.push("\nRecent news and public info Anchor already gathered on this company (also shown live in the room right now, so treat it as something the person you're helping can already see):");
    if (ctx.newsHeadline) parts.push(ctx.newsHeadline);
    if (ctx.companyResearch) parts.push(ctx.companyResearch);
  }

  return parts.join("\n");
}

export async function askAnchor(params: {
  context: DealContext;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
}): Promise<string> {
  const contextBlock = buildContextBlock(params.context);

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    system: `You are Anchor, a live meeting assistant. Someone is in the middle of a real meeting right now and typed you a quick question — they need a short, useful, immediately usable answer, not a lecture.

Ground every answer in the deal context you're given below (past meeting summaries, action items, continuity notes, file names) first. You also have a live web search tool — reach for it when the question needs something current that wouldn't be in the deal context: recent company news, funding, industry trends, competitor moves, market conditions. Only search about the company/industry, never to look up a named individual. If neither the deal context nor a search turns up an answer, say plainly that Anchor doesn't have that information yet — never invent facts, numbers, names, or commitments.

Keep answers to 2-4 sentences unless the question clearly calls for a short list. Write like you're quietly feeding them a talking point mid-meeting, not writing a report.

--- Deal context ---
${contextBlock}`,
    messages: [
      ...params.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: params.question },
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
