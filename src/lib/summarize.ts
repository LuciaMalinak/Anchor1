import Anthropic from "@anthropic-ai/sdk";
import type { Utterance } from "./transcribe";

// Centralized so it's a one-line change if this needs to point at a
// different model later.
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

function transcriptToPlainText(utterances: Utterance[]): string {
  return utterances
    .map((u) => `${u.speakerLabel}: ${u.text}`)
    .join("\n");
}

export type SpeakerFinding = {
  speakerLabel: string;
  inferredName: string | null;
  note: string;
};

export type MeetingSummaryResult = {
  suggestedTitle: string;
  overview: string;
  keyPoints: string[];
  actionItems: { text: string; owner: string | null }[];
  speakers: SpeakerFinding[];
};

const SUMMARY_TOOL = {
  name: "record_meeting_summary",
  description: "Record a structured summary of a meeting transcript.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestedTitle: {
        type: "string",
        description: "A short, specific title for this meeting (5-8 words).",
      },
      overview: {
        type: "string",
        description: "A 2-4 sentence plain-language overview of what the meeting was about and how it went.",
      },
      keyPoints: {
        type: "array",
        items: { type: "string" },
        description: "3-6 concrete, specific points from the discussion. No generic filler.",
      },
      actionItems: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            owner: {
              type: ["string", "null"],
              description: "Who is responsible, by name, if it's clear from the transcript. Otherwise null.",
            },
          },
          required: ["text", "owner"],
        },
      },
      speakers: {
        type: "array",
        description: "One entry per distinct speaker label present in the transcript.",
        items: {
          type: "object",
          properties: {
            speakerLabel: { type: "string" },
            inferredName: {
              type: ["string", "null"],
              description: "This speaker's real name, ONLY if it is stated or clearly implied in the transcript (e.g. someone addresses them by name, or they introduce themselves). Otherwise null — never guess.",
            },
            note: {
              type: "string",
              description: "1-2 sentence factual note on what this specific person said, asked for, or cared about in this meeting. Used to build a running relationship history, so be concrete, not generic.",
            },
          },
          required: ["speakerLabel", "inferredName", "note"],
        },
      },
    },
    required: ["suggestedTitle", "overview", "keyPoints", "actionItems", "speakers"],
  },
};

export async function summarizeMeeting(
  utterances: Utterance[]
): Promise<MeetingSummaryResult> {
  const transcriptText = transcriptToPlainText(utterances);

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system:
      "You summarize real business meeting transcripts accurately and conservatively. Never invent facts, names, or commitments that aren't in the transcript. If something is unclear, say so rather than guessing.",
    tools: [SUMMARY_TOOL],
    tool_choice: { type: "tool", name: SUMMARY_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Here is a meeting transcript with speakers separated. Summarize it.\n\n${transcriptText}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a structured summary.");
  }

  return toolUse.input as MeetingSummaryResult;
}

const MEMORY_TOOL = {
  name: "record_contact_memory_update",
  description:
    "Record an updated rolling summary of what's known about a contact, and a one-sentence continuity note for the current meeting.",
  input_schema: {
    type: "object" as const,
    properties: {
      updatedRelationshipSummary: {
        type: "string",
        description:
          "A 2-4 sentence rolling summary of who this person is and what matters to them, merging the prior summary with what was learned in this meeting. Keep it factual and current — drop stale details this meeting has superseded.",
      },
      continuityLine: {
        type: "string",
        description:
          "One sentence, written for the meeting owner, connecting this meeting to the relationship history with this person (e.g. what changed, what was followed up on).",
      },
    },
    required: ["updatedRelationshipSummary", "continuityLine"],
  },
};

export async function mergeContactMemory(params: {
  contactName: string;
  priorSummary: string;
  meetingCount: number;
  newNote: string;
}): Promise<{ updatedRelationshipSummary: string; continuityLine: string }> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 512,
    system:
      "You maintain a concise, accurate rolling summary of a business relationship across multiple meetings. Never invent details.",
    tools: [MEMORY_TOOL],
    tool_choice: { type: "tool", name: MEMORY_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Contact: ${params.contactName}\nMeetings with them so far (including today): ${params.meetingCount}\n\nExisting relationship summary:\n${params.priorSummary}\n\nWhat happened with them in today's meeting:\n${params.newNote}\n\nProduce an updated relationship summary and a one-sentence continuity note.`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a structured memory update.");
  }

  return toolUse.input as {
    updatedRelationshipSummary: string;
    continuityLine: string;
  };
}
