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
  continuityNote: string | null;
  recentMeetings: {
    title: string;
    occurredAt: string;
    overview: string;
    keyPoints: string[];
    actionItems: { text: string; owner: string | null }[];
  }[];
  fileNames: string[];
};

function buildContextBlock(ctx: DealContext): string {
  const parts: string[] = [`Deal: ${ctx.dealName}`];

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
    max_tokens: 400,
    system: `You are Anchor, a live meeting assistant. Someone is in the middle of a real meeting right now and typed you a quick question — they need a short, useful, immediately usable answer, not a lecture.

Ground every answer in the deal context you're given below (past meeting summaries, action items, continuity notes, file names). If the answer isn't in that context, say plainly that Anchor doesn't have that information yet — never invent facts, numbers, names, or commitments that weren't given to you.

Keep answers to 2-4 sentences unless the question clearly calls for a short list. Write like you're quietly feeding them a talking point mid-meeting, not writing a report.

--- Deal context ---
${contextBlock}`,
    messages: [
      ...params.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: params.question },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anchor didn't return an answer.");
  }
  return textBlock.text;
}
