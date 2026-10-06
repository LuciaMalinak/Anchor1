import Anthropic from "@anthropic-ai/sdk";
import { meteredFetch } from "./aiUsage";
import { createWithForcedTool } from "./forcedTool";
import type { LiveDealContext } from "./liveContext";

// Real-time nudges and question answers during an active meeting —
// fast beats maximally capable here, since this has to keep up with a
// live conversation. Deliberately NOT ANTHROPIC_MODEL: that's set for
// the slower, non-real-time features (summaries, memory…), and live
// coaching inheriting a bigger model from it made suggestions and
// question answers lag seconds behind the call. ANTHROPIC_LIVE_MODEL
// overrides just the live features if that trade-off ever needs moving.
export const DEFAULT_LIVE_MODEL = "claude-haiku-4-5-20251001";
export const LIVE_MODEL = process.env.ANTHROPIC_LIVE_MODEL || DEFAULT_LIVE_MODEL;
const DEFAULT_MODEL = DEFAULT_LIVE_MODEL;
const MODEL = LIVE_MODEL;
// Was 512 — too tight for 1-3 nudges + a full checklist + a suggested
// answer, and newer models (which think by default when ANTHROPIC_MODEL
// points at one) spend part of it reasoning first, so the tool call got
// cut off mid-way.
const MAX_TOKENS = 4096;

// feature labels the calls for usage tracking (see aiUsage.ts).
export function liveClient(feature: "live_coaching" | "live_questions" = "live_coaching") {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and add it to .env.local"
    );
  }
  return new Anthropic({ apiKey, fetch: meteredFetch(feature) });
}

export type LiveCoaching = {
  nudges: string[];
  checklist: { label: string; covered: boolean }[];
  // The most recent still-open question from the other side, with a
  // grounded suggested answer — null when nothing's currently hanging.
  // See sanitizeLiveQuestion below for how this gets derived from the
  // tool call's flat fields. askedAt is set only by the instant question
  // path (liveQuestion.ts) — an empty suggestedAnswer with askedAt means
  // the answer is still being written.
  // answering is true while the instant path is still streaming the
  // answer in, so the panel can show it's still being written.
  liveQuestion: { question: string; suggestedAnswer: string; askedAt?: number; answering?: boolean } | null;
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
          "1-3 short, specific, actionable talking points or things to watch for. This should almost never be empty: when the live transcript has something to react to, ground nudges in that first ('They just raised a concern about integration time — address it before moving on'); when it hasn't (early in the call, a quiet stretch, or nothing transcribed yet), fall back to what's already known about this deal — prep notes, decision boundaries, what happened last meeting — and turn THAT into a concrete nudge instead of waiting for something to happen live (e.g. 'They haven't mentioned budget yet — worth asking directly,' 'Last meeting they asked about our SOC 2 status — worth confirming it comes up,' 'Notes say to lead with the integration story — bring it up early'). Only return an empty array when there is truly nothing to go on at all — no transcript yet AND no prep notes, decision boundaries, or past meetings for this deal. Never generic sales advice ('build rapport', 'listen actively'), and never invent a fact, number, or commitment to fill a real gap — if something needs addressing but you genuinely don't have anything concrete to say about it, phrase the nudge as flagging that gap plainly and that it's worth circling back on next meeting.",
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
          "The full talking-point checklist for this call (keep the same items across updates whenever possible, just flip 'covered' as topics come up) — a handful of concrete things this call should cover given the deal's prep notes and decision boundaries, each marked covered:true only if the transcript shows it was actually discussed. Leave it out entirely when the message says to keep the checklist as it is.",
      },
      questionAsked: {
        type: "boolean",
        description:
          "True if the OTHER side (never the rep) has asked something in the transcript that still looks unanswered as of the very end of the transcript — a real question needing a real answer, not a rhetorical one or small talk. Stays true across updates for the same still-open question even if it was asked a little earlier in the window, as long as the rep hasn't visibly addressed it yet. Flip to false the moment the transcript shows the rep answered it (even roughly) or a newer open question replaces it.",
      },
      question: {
        type: "string",
        description:
          "The other side's exact (or lightly cleaned-up) question, verbatim-ish — empty string when questionAsked is false.",
      },
      suggestedAnswer: {
        type: "string",
        description:
          "A short, concrete, ready-to-say answer to that question, grounded only in what's known about this deal (memory, notes, decision boundaries, past meetings, attached files) — written like a talking point the rep could say almost as-is, not a summary. If the real answer isn't something you actually know, say so plainly ('Anchor doesn't have pricing for that tier — worth saying you'll follow up') rather than inventing a number, date, or commitment. Never suggest committing to anything outside the deal's decision boundaries — if the question asks for exactly that, the suggested answer should say to note it and follow up rather than decide it live. Empty string when questionAsked is false.",
      },
    },
    required: ["nudges", "questionAsked", "question", "suggestedAnswer"],
  },
};

type SystemPrompt = string | Anthropic.TextBlockParam[];

function requestCoaching(system: SystemPrompt, content: string, model: string = MODEL) {
  return createWithForcedTool(liveClient(), {
    model,
    max_tokens: MAX_TOKENS,
    system,
    tools: [LIVE_COACHING_TOOL],
    tool_choice: { type: "tool", name: LIVE_COACHING_TOOL.name },
    messages: [{ role: "user", content }],
  });
}

// Live coaching used to make exactly one attempt and, on any error, the
// live route just logged it — so the Suggestions panel sat on
// "Preparing suggestions…" for the whole call with no sign anything was
// wrong. Newer models rejecting forced tool use is handled in
// createWithForcedTool (see forcedTool.ts); on top of that, a
// misspelled/retired ANTHROPIC_MODEL 404s, so fall back to the default
// fast model rather than going dark for the whole call.
async function requestCoachingWithFallbacks(system: SystemPrompt, content: string) {
  try {
    return await requestCoaching(system, content);
  } catch (err) {
    if (err instanceof Anthropic.NotFoundError && MODEL !== DEFAULT_MODEL) {
      console.warn(`[live coaching] model ${MODEL} not found, falling back to ${DEFAULT_MODEL}`);
      return await requestCoaching(system, content, DEFAULT_MODEL);
    }
    throw err;
  }
}

// Plain-language reason shown in the Suggestions panel when coaching
// can't be generated at all, instead of an endless "Preparing…".
export function describeCoachingError(err: unknown): string {
  if (err instanceof Error && /ANTHROPIC_API_KEY is not set/.test(err.message)) {
    return "Suggestions are off: ANTHROPIC_API_KEY is missing on the server.";
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return "Suggestions are off: the AI key isn't working. Check ANTHROPIC_API_KEY in Render.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return "Suggestions are off: the AI model isn't available. Check ANTHROPIC_MODEL in Render.";
  }
  if (err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503))) {
    return "The AI is busy right now — suggestions will retry in a few seconds.";
  }
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
    return "Suggestions are off: the Anthropic account is out of credits.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Couldn't generate suggestions (AI error ${err.status ?? "unknown"}) — retrying.`;
  }
  return "Couldn't generate suggestions — retrying.";
}

// The tool call gives flat fields (easier for the model to fill in
// reliably than a nested optional object); this turns them into the
// nullable shape everything downstream actually wants to store/render.
function sanitizeLiveQuestion(raw: {
  questionAsked?: unknown;
  question?: unknown;
  suggestedAnswer?: unknown;
}): { question: string; suggestedAnswer: string } | null {
  const asked = raw.questionAsked === true;
  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  const suggestedAnswer = typeof raw.suggestedAnswer === "string" ? raw.suggestedAnswer.trim() : "";
  if (!asked || !question || !suggestedAnswer) return null;
  return { question, suggestedAnswer };
}

// The deal-facts block shared by live coaching and live question answers
// (liveQuestion.ts), so both are grounded in exactly the same material.
export function liveDealContextText(params: LiveDealContext): string {
  const leadStyleText = params.leadStyle
    ? `\n\nHow the deal lead actually operates — guidance should sound like it comes from them, not generic coaching: ${params.leadStyle}`
    : "";
  const notesText = params.notes
    ? `\n\nWhat the rep prepped going into this call (their own notes, written before it started — treat this as their intent and prioritize it in the checklist): ${params.notes}`
    : "";
  const pastMeetingsText = params.pastMeetings.length
    ? `\n\nPrevious meetings on this deal (most recent first) — reference these specifically when relevant, don't just treat them as background:\n${params.pastMeetings
        .map((m) => {
          const signals = m.dealSignals.length
            ? ` Flagged at the time: ${m.dealSignals.map((s) => `[${s.type.replace("_", " ")}] ${s.detail}`).join("; ")}.`
            : "";
          return `- ${m.title} (${m.occurredAt}): ${m.overview}${signals}`;
        })
        .join("\n")}`
    : "";
  const emailContextText = params.emailContext
    ? `\n\nRecent emails with people on this deal: ${params.emailContext}`
    : "";
  const documentContextText = params.documentContext
    ? `\n\nDocuments about this deal from Google Drive / Dropbox: ${params.documentContext.slice(0, 3000)}`
    : "";
  const calendarContextText = params.calendarContext
    ? `\n\nRecent and upcoming calendar meetings with people on this deal: ${params.calendarContext}`
    : "";
  const attachedFilesText = params.attachedFiles
    ? `\n\nFiles/voice notes attached to this deal ahead of the call:\n${params.attachedFiles}`
    : "";

  return `Deal: ${params.dealName || "Unnamed deal"}

What we know about this deal so far: ${params.dealMemory || "Nothing yet — this may be an early meeting."}

Decision boundaries / constraints for this deal: ${params.decisionBoundaries || "None recorded."}${leadStyleText}${notesText}${attachedFilesText}${pastMeetingsText}${emailContextText}${calendarContextText}${documentContextText}`;
}

// Regenerates live coaching (nudges + checklist) for a meeting that's
// actively in progress, from the transcript captured so far. Called from
// the live-poll API route (src/app/api/meetings/[id]/live/route.ts) when
// new speech has arrived — never once per transcript webhook, since
// that would mean an AI call several times a second. Questions get a
// much faster dedicated path (liveQuestion.ts); this still watches for
// them too, as a backstop for questions that path's quick check misses.
export async function generateLiveCoaching(
  params: LiveDealContext & {
    recentTranscript: string;
    priorChecklist: { label: string; covered: boolean }[] | null;
    // false = keep priorChecklist as is this time, which keeps the reply
    // (and its cost) much shorter.
    updateChecklist?: boolean;
  }
): Promise<LiveCoaching> {
  const updateChecklist = params.updateChecklist !== false || !params.priorChecklist?.length;
  const priorChecklistText = params.priorChecklist?.length
    ? `\n\nChecklist from the last update (keep these labels, just update covered status, unless the conversation clearly calls for a different item):\n${params.priorChecklist
        .map((c) => `- [${c.covered ? "x" : " "}] ${c.label}`)
        .join("\n")}`
    : "";

  const system =
    "You are a live sales-call coach watching a transcript stream in during a real meeting, and this runs on a repeating timer for as long as the call lasts — the rep should always have something current to look at, not a panel that goes blank the moment the live conversation itself doesn't hand you something new. Give sharp, specific, non-generic guidance: ground it in what's actually been said when there's something to react to, and otherwise ground it in what's already known about this deal from its prep notes, decision boundaries, and past meetings — never leave nudges empty just because the last few seconds of transcript were quiet. Never invent facts, commitments, or objections that didn't happen, and never invent detail to fill a gap you don't actually have information for — if there's truly nothing to go on yet (no transcript, no prep, no history), say so plainly rather than inventing something. If the transcript so far doesn't support a checklist item being covered, mark it not covered. You're also watching for a specific kind of moment: the other side asking something that needs answering right now, like a live interview-assist tool would — when that happens, surface it and a ready-to-say answer separately from the general nudges above (see questionAsked/question/suggestedAnswer), grounded the same way, and respecting decision boundaries the same way.";

  // The deal facts don't change between refreshes, so they sit in a
  // cached system block — every refresh after the first in a call skips
  // re-reading them, which is most of the prompt. Only the checklist and
  // transcript (which do change) go in the message.
  const message = await requestCoachingWithFallbacks(
    [
      { type: "text", text: system },
      { type: "text", text: liveDealContextText(params), cache_control: { type: "ephemeral" } },
    ],
    `${
      updateChecklist
        ? priorChecklistText.trim() || "No checklist yet — draft one."
        : "Keep the checklist as it is this time — leave it out of your reply."
    }

Transcript so far (most recent portion of an in-progress call):
${params.recentTranscript || "(nothing transcribed yet)"}`
  );

  if (message.stop_reason === "max_tokens") {
    console.warn(`[live coaching] response hit max_tokens (${MAX_TOKENS}) — output may be incomplete`);
  }

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return structured live coaching.");
  }

  const raw = toolUse.input as {
    nudges?: unknown;
    checklist?: unknown;
    questionAsked?: unknown;
    question?: unknown;
    suggestedAnswer?: unknown;
  };

  const returnedChecklist = Array.isArray(raw.checklist)
    ? raw.checklist.filter(
        (c): c is { label: string; covered: boolean } =>
          Boolean(c) && typeof c === "object" && typeof (c as { label?: unknown }).label === "string"
      )
    : [];

  return {
    nudges: Array.isArray(raw.nudges) ? raw.nudges.filter((n): n is string => typeof n === "string") : [],
    checklist: returnedChecklist.length && updateChecklist ? returnedChecklist : params.priorChecklist ?? [],
    liveQuestion: sanitizeLiveQuestion(raw),
  };
}
