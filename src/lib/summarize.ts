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
              description: "1-2 sentence factual note on what this specific person said, asked for, or cared about in this meeting. Used to build a running relationship history, so be concrete, not generic. If they mentioned anything personal in passing — family, a hobby, travel, an upcoming event, how they take their coffee, small talk before getting down to business — include that too in a few extra words; those small human details matter for building rapport, especially for someone else stepping in later.",
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
          "A 2-4 sentence rolling summary of who this person is and what matters to them, merging the prior summary with what was learned in this meeting. Keep it factual and current — drop stale details this meeting has superseded. Include small personal/human details when known (family, hobbies, personal milestones, how they like to communicate) alongside the business facts — not as the whole summary, but don't drop them either; they're what makes someone else stepping in sound like they actually know this person.",
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

const DEAL_MEMORY_TOOL = {
  name: "record_deal_memory_update",
  description:
    "Record an updated rolling summary of everything known about a deal/account so far, across all its meetings.",
  input_schema: {
    type: "object" as const,
    properties: {
      updatedMemory: {
        type: "string",
        description:
          "A 3-6 sentence rolling summary of this deal — where it stands, what matters to the people on the other side, what's blocking or driving it forward — merging the prior memory with what was learned in this meeting. Keep it factual and current; drop details this meeting has superseded rather than piling everything on.",
      },
    },
    required: ["updatedMemory"],
  },
};

export async function mergeDealMemory(params: {
  dealName: string;
  priorMemory: string | null;
  newSummary: {
    overview: string;
    keyPoints: string[];
    actionItems: { text: string; owner: string | null }[];
  };
}): Promise<string> {
  const actionItemsText = params.newSummary.actionItems
    .map((a) => a.text + (a.owner ? ` (${a.owner})` : ""))
    .join("; ");

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 512,
    system:
      "You maintain a concise, accurate rolling summary of a business deal/account across multiple meetings. Never invent details that weren't given to you.",
    tools: [DEAL_MEMORY_TOOL],
    tool_choice: { type: "tool", name: DEAL_MEMORY_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Deal: ${params.dealName}\n\nExisting deal memory:\n${params.priorMemory || "No prior notes — this is the first meeting."}\n\nWhat happened in today's meeting on this deal:\nOverview: ${params.newSummary.overview}\nKey points: ${params.newSummary.keyPoints.join("; ")}\nAction items: ${actionItemsText || "None"}\n\nProduce an updated rolling memory for this deal.`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a structured deal memory update.");
  }

  return (toolUse.input as { updatedMemory: string }).updatedMemory;
}
