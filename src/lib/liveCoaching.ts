import Anthropic from "@anthropic-ai/sdk";

// Real-time nudges during an active meeting — same latency-first
// reasoning as liveAssist.ts's MODEL choice: fast beats maximally
// capable here, since this has to keep up with a live conversation.
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

export type LiveCoaching = {
  nudges: string[];
  checklist: { label: string; covered: boolean }[];
};

const LIVE_COACHING_TOOL = {
  name: "record_live_coaching",
  description:
    "Record short live coaching for a sales rep who is actively in a meeting right now, based on the transcript so far.",
  input_schema: {
    type: "object" as const,
    properties: {
      nudges: {
        type: "array",
        items: { type: "string" },
        description:
          "1-3 short, specific, actionable talking points or things to watch for, based on what's actually been said so far — e.g. 'They haven't mentioned budget yet — worth asking directly' or 'They just raised a concern about integration time — address it before moving on'. Never generic sales advice ('build rapport', 'listen actively'). If nothing notable stands out yet, return an empty array rather than padding with filler.",
      },
      checklist: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            covered: { type: "boolean" },
          },
          required: ["label", "covered"],
        },
        description:
          "The full talking-point checklist for this call (keep the same items across updates whenever possible, just flip 'covered' as topics come up) — a handful of concrete things this call should cover given the deal's prep notes and decision boundaries, each marked covered:true only if the transcript shows it was actually discussed.",
      },
    },
    required: ["nudges", "checklist"],
  },
};

// Regenerates live coaching (nudges + checklist) for a meeting that's
// actively in progress, from the transcript captured so far. Called on
// a debounced timer from the live-poll API route — see
// src/app/api/meetings/[id]/live/route.ts — never on every single
// incoming transcript webhook, since that would mean an AI call several
// times a second.
export async function generateLiveCoaching(params: {
  dealName: string | null;
  dealMemory: string | null;
  decisionBoundaries: string | null;
  recentTranscript: string;
  priorChecklist: { label: string; covered: boolean }[] | null;
  // How the deal's actual lead tends to negotiate, decide, and
  // communicate (see src/lib/styleProfile.ts) — null if no lead is set,
  // or there isn't enough of their own material yet.
  leadStyle?: string | null;
  // Whatever the rep typed in "Before" prep for this deal (deals.notes) —
  // the whole point is that this carries straight into the live nudges
  // without needing deals.memory to have absorbed it first, which only
  // happens after a meeting finishes. See DealHeaderCard on DealTabs.tsx.
  notes?: string | null;
}): Promise<LiveCoaching> {
  const priorChecklistText = params.priorChecklist?.length
    ? `\n\nChecklist from the last update (keep these labels, just update covered status, unless the conversation clearly calls for a different item):\n${params.priorChecklist
        .map((c) => `- [${c.covered ? "x" : " "}] ${c.label}`)
        .join("\n")}`
    : "";
  const leadStyleText = params.leadStyle
    ? `\n\nHow the deal lead actually operates — nudges should sound like guidance from them, not generic coaching: ${params.leadStyle}`
    : "";
  const notesText = params.notes
    ? `\n\nWhat the rep prepped going into this call (their own notes, written before it started — treat this as their intent and prioritize it in the checklist): ${params.notes}`
    : "";

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 512,
    system:
      "You are a live sales-call coach watching a transcript stream in during a real meeting. Give sharp, specific, non-generic guidance grounded only in what's actually been said — never invent facts, commitments, or objections that didn't happen. If the transcript so far doesn't support a checklist item being covered, mark it not covered.",
    tools: [LIVE_COACHING_TOOL],
    tool_choice: { type: "tool", name: LIVE_COACHING_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Deal: ${params.dealName || "Unnamed deal"}

What we know about this deal so far: ${params.dealMemory || "Nothing yet — this may be an early meeting."}

Decision boundaries / constraints for this deal: ${params.decisionBoundaries || "None recorded."}${leadStyleText}${notesText}
${priorChecklistText}

Transcript so far (most recent portion of an in-progress call):
${params.recentTranscript || "(nothing transcribed yet)"}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return structured live coaching.");
  }

  return toolUse.input as LiveCoaching;
}
