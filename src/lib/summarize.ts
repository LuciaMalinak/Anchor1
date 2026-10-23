import Anthropic from "@anthropic-ai/sdk";
import { meteredFetch } from "./aiUsage";
import { createWithForcedTool } from "./forcedTool";
import type { Utterance } from "./transcribe";
import { playbookSummaryText, type IndustryPlaybook } from "./industryPlaybooks";

// Centralized so it's a one-line change if this needs to point at a
// different model later.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and add it to .env.local"
    );
  }
  return new Anthropic({ apiKey, fetch: meteredFetch("meeting_summaries") });
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

export type DealSignal = { type: "buying_signal" | "risk" | "blocker"; detail: string };

export type MeetingSummaryResult = {
  suggestedTitle: string;
  overview: string;
  keyPoints: string[];
  actionItems: { text: string; owner: string | null }[];
  speakers: SpeakerFinding[];
  dealSignals: DealSignal[];
  industryFacts: { label: string; value: string }[];
  complianceFlags: { rule: string; detail: string }[];
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
        description:
          "A 4-7 sentence plain-language overview: who was on the call and why, what was covered, what was decided or agreed, how the other side reacted, and where things stand now. Specific (names, numbers, dates), no filler.",
      },
      keyPoints: {
        type: "array",
        items: { type: "string" },
        description:
          "5-12 detailed points covering everything important for the next steps: what the other side needs and why, numbers (price, budget, seats, volumes), dates and deadlines, decisions made, commitments either side made, objections and how they were handled, open questions still to answer, and who else is involved in the decision. Start each with its topic (e.g. \"Pricing: …\", \"Timeline: …\"). Keep every specific — names, figures, dates — exactly as said. No generic filler.",
      },
      actionItems: {
        type: "array",
        description:
          "Every concrete next step either side committed to or that clearly has to happen for the deal to move — include the deadline in the text when one was said (\"Send the security questionnaire by Friday\").",
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
      dealSignals: {
        type: "array",
        description:
          "0-4 concrete, sales-relevant moments — a genuine buying signal, a risk/objection, or something actively blocking progress. Only include ones clearly grounded in what was actually said. Leave empty rather than stretching for one that isn't really there.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["buying_signal", "risk", "blocker"],
              description:
                "buying_signal: a concrete sign they want to move forward (asked about pricing/timeline, mentioned internal buy-in, etc). risk: a stated concern, objection, or reason they might not proceed. blocker: something specific and immediate stopping the next step (e.g. waiting on legal, budget not approved yet).",
            },
            detail: {
              type: "string",
              description: "One concrete sentence, specific to this meeting — not generic advice.",
            },
          },
          required: ["type", "detail"],
        },
      },
      industryFacts: {
        type: "array",
        description:
          "Only when deal-sheet fields for this team's industry are given: one entry per field the call actually covered, using the field's label exactly, with what was said (specific: names, figures, dates). Leave out fields the call didn't touch. Empty when no fields are given.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
          },
          required: ["label", "value"],
        },
      },
      complianceFlags: {
        type: "array",
        description:
          "Only when industry rules are given: each moment on this call that broke, came close to, or triggers follow-up under one of them (e.g. a patient side effect that must be reported, a buyer told another bidder's price, steering language). rule is the rule's label; detail says what was said and what to do now, in one sentence. Empty when nothing on the call touched a rule — never pad it.",
        items: {
          type: "object",
          properties: {
            rule: { type: "string" },
            detail: { type: "string" },
          },
          required: ["rule", "detail"],
        },
      },
    },
    required: ["suggestedTitle", "overview", "keyPoints", "actionItems", "speakers", "dealSignals"],
  },
};

export async function summarizeMeeting(
  utterances: Utterance[],
  // Optional deal-level background — the deal's rolling memory and its
  // email digest (see dealEmailDigest.ts) — so the summary and action
  // items this meeting produces can connect what was actually said to
  // what's already known about the deal (e.g. a commitment made over
  // email getting confirmed or updated on the call). This is background
  // ONLY: the model is still asked to ground everything in the
  // transcript, never to invent an action item purely from an email that
  // was never mentioned on the call.
  dealContext?: { memory?: string | null; emailContext?: string | null } | null,
  // The team's playbook (its specialty's, or its industry's), for its deal
  // sheet fields and rules.
  playbook?: IndustryPlaybook | null
): Promise<MeetingSummaryResult> {
  const transcriptText = transcriptToPlainText(utterances);

  const dealContextBlock =
    dealContext?.memory || dealContext?.emailContext
      ? `\n\nBackground on this deal, for context only — ground your summary and action items in what was actually said on THIS call, not in this background alone:\n${
          dealContext.memory ? `Deal history: ${dealContext.memory}\n` : ""
        }${dealContext.emailContext ? `Relevant email history: ${dealContext.emailContext}` : ""}`
      : "";

  const message = await createWithForcedTool(client(), {
    model: MODEL,
    // Was 2048: an hour-long call's summary ran past it, the reply was cut
    // off mid-way and came back without its speakers list, and processing
    // crashed ("undefined is not iterable") — the meeting showed as failed.
    max_tokens: 8192,
    system:
      "You write detailed, accurate summaries of real sales and business calls for the team that has to act on them next. Capture everything that matters for the next steps — needs, numbers, dates, decisions, commitments, objections, open questions — and nothing generic. The transcript may come from live speech-to-text: expect misheard words, missing punctuation and occasionally wrong speaker labels, and read through them using context (fix an obviously misheard product or company name; don't treat a garbled phrase as a fact). Never invent facts, names, or commitments that aren't in the transcript. If something is unclear, say so rather than guessing.",
    tools: [SUMMARY_TOOL],
    tool_choice: { type: "tool", name: SUMMARY_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Here is a meeting transcript with speakers separated. Summarize it.\n\n${transcriptText}${dealContextBlock}${playbookSummaryText(playbook)}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a structured summary.");
  }

  if (message.stop_reason === "max_tokens") {
    console.warn("[summarize] summary hit max_tokens — using what came back");
  }
  return normalizeSummary(toolUse.input);
}

// A reply cut short, or one missing a field, still makes a usable summary
// instead of crashing whatever reads it.
function normalizeSummary(raw: unknown): MeetingSummaryResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof MeetingSummaryResult, unknown>>;
  const list = <T,>(v: unknown, ok: (x: unknown) => boolean): T[] => (Array.isArray(v) ? (v.filter(ok) as T[]) : []);
  const isObj = (x: unknown) => Boolean(x) && typeof x === "object";
  return {
    suggestedTitle: typeof r.suggestedTitle === "string" ? r.suggestedTitle : "",
    overview: typeof r.overview === "string" && r.overview.trim() ? r.overview : "Summary unavailable — see the transcript.",
    keyPoints: list<string>(r.keyPoints, (x) => typeof x === "string"),
    actionItems: list<MeetingSummaryResult["actionItems"][number]>(
      r.actionItems,
      (x) => isObj(x) && typeof (x as { text?: unknown }).text === "string"
    ).map((a) => ({ text: a.text, owner: typeof a.owner === "string" ? a.owner : null })),
    speakers: list<SpeakerFinding>(r.speakers, (x) => isObj(x) && typeof (x as { speakerLabel?: unknown }).speakerLabel === "string").map(
      (sp) => ({ speakerLabel: sp.speakerLabel, inferredName: typeof sp.inferredName === "string" ? sp.inferredName : null, note: typeof sp.note === "string" ? sp.note : "" })
    ),
    dealSignals: list<DealSignal>(r.dealSignals, isObj),
    industryFacts: list<{ label: string; value: string }>(
      r.industryFacts,
      (x) => isObj(x) && typeof (x as { label?: unknown }).label === "string" && typeof (x as { value?: unknown }).value === "string"
    ).filter((f) => f.value.trim()),
    complianceFlags: list<{ rule: string; detail: string }>(
      r.complianceFlags,
      (x) => isObj(x) && typeof (x as { rule?: unknown }).rule === "string" && typeof (x as { detail?: unknown }).detail === "string"
    ),
  };
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
      keyChanges: {
        type: "array",
        items: { type: "string" },
        description:
          "0-3 short bullet points of what actually changed vs. the PRIOR summary — a fact that got corrected, something newly learned, or something dropped because it's now stale/superseded. Empty array if this meeting only reinforced what was already known.",
      },
    },
    required: ["updatedRelationshipSummary", "continuityLine", "keyChanges"],
  },
};

type ContactMemoryUpdate = {
  updatedRelationshipSummary: string;
  continuityLine: string;
  keyChanges: string[];
};

// Two modes, same tool/output shape:
//
// - Incremental (the default, every meeting): merge the prior summary
//   string with just this meeting's note. Fast and cheap, but it's
//   compounting a summary of a summary — over many meetings that's lossy
//   compression with no way to check itself against what was actually
//   said, so small errors can accumulate ("drift").
//
// - Resynthesis (periodic — see shouldResynthesize in processMeeting.ts):
//   re-derive the summary from the actual raw per-meeting notes
//   (rawHistory, from the contactNotes table) rather than trusting only
//   the current summary string. This is the self-correcting step: it
//   doesn't need a person to notice and fix a drifted summary, it
//   automatically re-grounds itself in the real history on a regular
//   cadence as more meetings accumulate.
//
// manualNotes (contacts.notes) is passed in both modes so a correction
// someone typed by hand actually informs future AI output — previously
// this field existed but was never read by either merge path.
export async function mergeContactMemory(params: {
  contactName: string;
  priorSummary: string;
  meetingCount: number;
  newNote: string;
  manualNotes?: string | null;
  resynthesize?: boolean;
  rawHistory?: { note: string; occurredAt: Date }[];
}): Promise<ContactMemoryUpdate> {
  const manualNotesBlock = params.manualNotes?.trim()
    ? `\n\nManual notes this person's teammate has written down about them directly (weigh these as ground truth — they were written by a human, not inferred):\n${params.manualNotes.trim()}`
    : "";

  const promptBody = params.resynthesize && params.rawHistory?.length
    ? `Contact: ${params.contactName}\nMeetings with them so far (including today): ${params.meetingCount}\n\n` +
      `The current rolling summary may have drifted after many incremental updates. Re-derive it from scratch using the actual raw notes below, rather than just trusting the current summary text.\n\n` +
      `Current (possibly drifted) summary:\n${params.priorSummary}\n\n` +
      `Raw notes from each meeting with them, oldest first:\n${params.rawHistory
        .map((h) => `- [${h.occurredAt.toISOString().slice(0, 10)}] ${h.note}`)
        .join("\n")}\n\n` +
      `Today's meeting:\n${params.newNote}${manualNotesBlock}\n\n` +
      `Produce a fresh, accurate relationship summary grounded in this real history, a continuity line, and note what changed vs. the current (possibly drifted) summary.`
    : `Contact: ${params.contactName}\nMeetings with them so far (including today): ${params.meetingCount}\n\n` +
      `Existing relationship summary:\n${params.priorSummary}\n\n` +
      `What happened with them in today's meeting:\n${params.newNote}${manualNotesBlock}\n\n` +
      `Produce an updated relationship summary, a one-sentence continuity note, and what changed vs. the prior summary.`;

  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 512,
    system:
      "You maintain a concise, accurate rolling summary of a business relationship across multiple meetings. Never invent details.",
    tools: [MEMORY_TOOL],
    tool_choice: { type: "tool", name: MEMORY_TOOL.name },
    messages: [{ role: "user", content: promptBody }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a structured memory update.");
  }

  return toolUse.input as ContactMemoryUpdate;
}

const FOLLOW_UP_EMAIL_TOOL = {
  name: "record_follow_up_email",
  description: "Record a draft follow-up email to send to the external people from a meeting.",
  input_schema: {
    type: "object" as const,
    properties: {
      subject: {
        type: "string",
        description: "A short, specific email subject line (not generic like 'Follow up').",
      },
      body: {
        type: "string",
        description:
          "The full email body, plain text (no HTML), starting with a greeting and ending with a sign-off using the sender's name. Warm and professional, not stiff. Reference only what's in the meeting summary provided — never invent commitments, numbers, or dates that weren't given. Keep it to a few short paragraphs plus a bulleted list of next steps if there are action items.",
      },
    },
    required: ["subject", "body"],
  },
};

export type FollowUpEmailDraft = { subject: string; body: string };

// A client-facing draft, distinct from the internal team recap email
// (see /api/deals/[id]/send-summary) — this one is meant to go out to
// the people who were actually in the meeting. We hand back a draft for
// the user to review and send themselves (via their own email client),
// rather than sending anything externally on their behalf.
export async function draftFollowUpEmail(params: {
  meetingTitle: string;
  overview: string;
  keyPoints: string[];
  actionItems: { text: string; owner: string | null }[];
  senderName: string;
  recipientNames: string[];
}): Promise<FollowUpEmailDraft> {
  const actionItemsText = params.actionItems
    .map((a) => `- ${a.text}${a.owner ? ` (${a.owner})` : ""}`)
    .join("\n");

  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 768,
    system:
      "You draft warm, professional, concise follow-up emails written in the sender's own voice after a real business meeting. Never invent commitments, numbers, dates, or facts that weren't given to you in the meeting summary.",
    tools: [FOLLOW_UP_EMAIL_TOOL],
    tool_choice: { type: "tool", name: FOLLOW_UP_EMAIL_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Draft a follow-up email from ${params.senderName} to ${
          params.recipientNames.length ? params.recipientNames.join(", ") : "the people they met with"
        }, following up on this meeting.\n\nMeeting: ${params.meetingTitle}\n\nOverview: ${params.overview}\n\nKey points:\n${params.keyPoints.map((k) => `- ${k}`).join("\n")}\n\nAction items:\n${actionItemsText || "None"}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a structured email draft.");
  }

  return toolUse.input as FollowUpEmailDraft;
}

// Raw model reply for suggestInvites.ts, which builds the prompt and
// parses/validates the JSON itself so its guardrails can be tested with a
// fake model (scripts/test-next-steps.ts).
export async function findFollowUpMeetingsText(prompt: string): Promise<string> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
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
          "The deal's working memory — what anyone picking up the next call or next step needs, merging the prior memory with what was learned in this meeting. Short labelled lines, in this order, leaving out a line only when nothing is known: Status (stage, momentum, the next scheduled step); People (who's involved on their side, their role, what each cares about); Needs (what they're trying to solve and why); Numbers (price/budget/seats/volumes discussed, discounts offered); Commitments (what each side promised, with dates); Open questions (still unanswered, and who owes the answer); Risks (objections, competitors, blockers); Next steps. Factual, specific, current — keep every name, figure and date; drop what this meeting superseded rather than piling everything on. Up to about 250 words.",
      },
      keyChanges: {
        type: "array",
        items: { type: "string" },
        description:
          "0-3 short bullet points of what actually changed vs. the PRIOR memory — a fact that got corrected, something newly learned, or something dropped because it's now stale/superseded. Empty array if this meeting only reinforced what was already known.",
      },
    },
    required: ["updatedMemory", "keyChanges"],
  },
};

type DealMemoryUpdate = { updatedMemory: string; keyChanges: string[] };

// Same incremental-vs-resynthesis idea as mergeContactMemory above. Deals
// don't need a dedicated raw-notes table for the resynthesis path — the
// `summary` row from every past meeting on this deal (joined via
// meeting.dealId) already IS that grounding history, so
// recentMeetings just passes those through.
export async function mergeDealMemory(params: {
  dealName: string;
  priorMemory: string | null;
  newSummary: {
    overview: string;
    keyPoints: string[];
    actionItems: { text: string; owner: string | null }[];
  };
  manualNotes?: string | null;
  // A short digest of files/voice notes attached to this deal (see
  // src/lib/dealFilesContext.ts) — background material, weighed the same
  // as manualNotes below.
  attachedFiles?: string | null;
  // The deal's smart-extracted email digest (see dealEmailDigest.ts /
  // dealIntegrationContext.ts) — commitments, facts, and open questions
  // pulled from connected-account email, folded in the same way as
  // attachedFiles so the rolling deal memory reflects what's actually
  // been said over email, not just what happened on calls.
  emailContext?: string | null;
  resynthesize?: boolean;
  recentMeetings?: {
    overview: string;
    keyPoints: string[];
    actionItems: { text: string; owner: string | null }[];
    occurredAt: Date;
  }[];
}): Promise<DealMemoryUpdate> {
  const actionItemsText = params.newSummary.actionItems
    .map((a) => a.text + (a.owner ? ` (${a.owner})` : ""))
    .join("; ");
  const manualNotesBlock = params.manualNotes?.trim()
    ? `\n\nManual notes someone on the team has written down about this deal directly (weigh these as ground truth — a human wrote these, not an inference):\n${params.manualNotes.trim()}`
    : "";
  const attachedFilesBlock = params.attachedFiles
    ? `\n\nFiles/voice notes attached to this deal:\n${params.attachedFiles}`
    : "";
  const emailContextBlock = params.emailContext
    ? `\n\nRelevant email history with this deal's contacts:\n${params.emailContext}`
    : "";

  const promptBody = params.resynthesize && params.recentMeetings?.length
    ? `Deal: ${params.dealName}\n\n` +
      `The current rolling memory may have drifted after many incremental updates. Re-derive it from scratch using the actual meeting summaries below, rather than just trusting the current memory text.\n\n` +
      `Current (possibly drifted) memory:\n${params.priorMemory || "No prior notes."}\n\n` +
      `Actual summaries from past meetings on this deal, oldest first:\n${params.recentMeetings
        .map(
          (m) =>
            `- [${m.occurredAt.toISOString().slice(0, 10)}] ${m.overview} Key points: ${m.keyPoints.join("; ")}${
              m.actionItems.length ? ` Action items: ${m.actionItems.map((a) => a.text).join("; ")}` : ""
            }`
        )
        .join("\n")}\n\n` +
      `Today's meeting:\nOverview: ${params.newSummary.overview}\nKey points: ${params.newSummary.keyPoints.join(
        "; "
      )}\nAction items: ${actionItemsText || "None"}${manualNotesBlock}${attachedFilesBlock}${emailContextBlock}\n\n` +
      `Produce a fresh, accurate memory grounded in this real history, and note what changed vs. the current (possibly drifted) memory.`
    : `Deal: ${params.dealName}\n\nExisting deal memory:\n${
        params.priorMemory || "No prior notes — this is the first meeting."
      }\n\nWhat happened in today's meeting on this deal:\nOverview: ${params.newSummary.overview}\nKey points: ${params.newSummary.keyPoints.join(
        "; "
      )}\nAction items: ${actionItemsText || "None"}${manualNotesBlock}${attachedFilesBlock}${emailContextBlock}\n\nProduce an updated rolling memory for this deal, and note what changed vs. the prior memory.`;

  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 1500,
    system:
      "You maintain the working memory of a sales deal across all its meetings, emails and notes — the one place the team (and Anchor's live call help) reads to know where the deal stands and what to do next. Keep it complete on what matters and accurate. Never invent details that weren't given to you.",
    tools: [DEAL_MEMORY_TOOL],
    tool_choice: { type: "tool", name: DEAL_MEMORY_TOOL.name },
    messages: [{ role: "user", content: promptBody }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a structured deal memory update.");
  }

  return toolUse.input as DealMemoryUpdate;
}
