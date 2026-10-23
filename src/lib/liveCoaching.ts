import Anthropic from "@anthropic-ai/sdk";
import { meteredFetch } from "./aiUsage";
import { createWithForcedTool } from "./forcedTool";
import { playbookLiveText } from "./industryPlaybooks";
import type { LiveDealContext } from "./liveContext";
import type { LiveCaution } from "@/db/schema";

// Real-time nudges and question answers during an active meeting —
// fast beats maximally capable here, since this has to keep up with a
// live conversation. Deliberately NOT ANTHROPIC_MODEL: that's set for
// the slower, non-real-time features (summaries, memory…), and live
// coaching inheriting a bigger model from it made suggestions and
// question answers lag seconds behind the call. ANTHROPIC_LIVE_MODEL
// overrides just the live features if that trade-off ever needs moving.
// Haiku 5.5 is both quicker and sharper at spotting and answering
// questions than Haiku 4.5; it thinks before answering by default, which
// live calls can't wait for, so thinking is switched off (LIVE_THINKING).
// If it's ever unavailable (or rejects a request), live features drop
// back to Haiku 4.5 rather than going dark mid-call.
export const DEFAULT_LIVE_MODEL = "claude-haiku-5-5";
export const FALLBACK_LIVE_MODEL = "claude-haiku-4-5-20251001";
export const LIVE_MODEL = process.env.ANTHROPIC_LIVE_MODEL || DEFAULT_LIVE_MODEL;
export const LIVE_THINKING = { type: "disabled" } as const;
const MODEL = LIVE_MODEL;

// Whether a failed live request is worth retrying once on the fallback
// model: the model doesn't exist for this key, or rejected the request.
export function shouldFallBackLive(err: unknown, model: string) {
  return (
    model !== FALLBACK_LIVE_MODEL &&
    (err instanceof Anthropic.NotFoundError || err instanceof Anthropic.BadRequestError)
  );
}
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

export type LiveAnswer = { topic: string; answer: string; at?: number };

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
  liveQuestion: {
    question: string;
    suggestedAnswer: string;
    askedAt?: number;
    answering?: boolean;
    caution?: LiveCaution | null;
  } | null;
  // What the other side has answered so far on this call (budget,
  // timeline, who decides…), newest first. Replaced the "so far" summary:
  // the person on the call already knows what was said; what they need
  // is what was learned.
  answers: LiveAnswer[];
  // What the person on the call mustn't agree to or bring up, from the
  // deal's decision boundaries and prep notes; raised once the client
  // has asked about it.
  offLimits: { label: string; raised: boolean }[];
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
          "0-2 small suggestions, each one line of at most 10 words, leading with the action ('Ask who signs off on budget'). Only what's worth saying right now: react to what was just said first ('They raised integration time: address it'); early in the call or in a quiet stretch, use the deal's prep notes, report gaps or last meeting instead ('Budget not raised yet: ask directly'). Empty when nothing new is worth saying. Never generic advice ('build rapport'), and never an invented fact, number or commitment.",
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
      answers: {
        type: "array",
        description:
          "New answers in the transcript: facts the OTHER side gave that answer something this call needs to find out (a checklist item, a gap in the deal's reports, a question the rep asked them), e.g. budget, timeline, who decides, volumes, terms, their position. Each with a short topic (at most 5 words) and their answer in at most 15 words, with their numbers and names as said. Only answers that appear in the transcript and aren't already in the list of answers caught so far. Empty when there are none.",
        items: {
          type: "object",
          properties: {
            topic: { type: "string" },
            answer: { type: "string" },
          },
          required: ["topic", "answer"],
        },
      },
      offLimits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            raised: { type: "boolean" },
          },
          required: ["label", "raised"],
        },
        description:
          "What the person on this call must NOT agree to, promise, or disclose on their own, taken only from the deal's decision boundaries, prep notes and the industry rules given with the deal facts (e.g. 'Discounts over 10%', 'Custom features', 'Contract changes') — each a short label of a few words, keeping the same labels across updates. raised:true once the other side has asked about or pushed on it in the transcript. Leave out what the boundaries say the rep CAN decide. Include each industry rule (by its label) when industry rules are given. Empty when the deal has no such limits recorded and no industry rules are given — never invent one. Leave it out entirely when the message says to keep the checklist as it is.",
      },
      questionAsked: {
        type: "boolean",
        description:
          "True if the OTHER side (never the rep) has asked something — or proposed or asked for a commitment, like a discount, terms or a date — in the transcript that still looks unanswered as of the very end of the transcript — a real question needing a real answer, not a rhetorical one or small talk. Stays true across updates for the same still-open question even if it was asked a little earlier in the window, as long as the rep hasn't visibly addressed it yet. Flip to false the moment the transcript shows the rep answered it (even roughly) or a newer open question replaces it.",
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
      answerCaution: {
        type: "string",
        enum: ["none", "amber", "red"],
        description:
          "For the open question: red if a straight answer would agree to or disclose something in offLimits / outside the decision boundaries / against an industry rule (suggestedAnswer must then defer it, not agree); amber if it depends on something not known or a commitment the boundaries don't cover — including any proposal or request from the client for a price, discount, payment or contract terms, dates, scope, custom work or extras when no decision boundaries are recorded (cautionReason then exactly 'Client proposal — get sign-off first', and suggestedAnswer acknowledges it without agreeing); otherwise none.",
      },
      cautionReason: {
        type: "string",
        description: "When answerCaution isn't none: why, in at most 8 words. Otherwise empty.",
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
    thinking: LIVE_THINKING,
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
    if (shouldFallBackLive(err, MODEL)) {
      console.warn(`[live coaching] ${MODEL} failed, falling back to ${FALLBACK_LIVE_MODEL}:`, err);
      return await requestCoaching(system, content, FALLBACK_LIVE_MODEL);
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
  answerCaution?: unknown;
  cautionReason?: unknown;
}): { question: string; suggestedAnswer: string; caution: LiveCaution | null } | null {
  const asked = raw.questionAsked === true;
  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  const suggestedAnswer = typeof raw.suggestedAnswer === "string" ? raw.suggestedAnswer.trim() : "";
  if (!asked || !question || !suggestedAnswer) return null;
  const level = raw.answerCaution === "red" || raw.answerCaution === "amber" ? raw.answerCaution : null;
  const reason = typeof raw.cautionReason === "string" ? raw.cautionReason.trim().slice(0, 140) : "";
  return { question, suggestedAnswer, caution: level ? { level, reason } : null };
}

// The deal-facts block shared by live coaching and live question answers
// (liveQuestion.ts), so both are grounded in exactly the same material.
export function liveDealContextText(params: LiveDealContext): string {
  const feedbackText = params.feedbackNotes?.length
    ? `\n\nWhat the person on this call told Anchor after their recent calls — follow it:\n${params.feedbackNotes.map((n) => `- ${n}`).join("\n")}`
    : "";
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
  const toolGapsText = params.toolGaps?.length
    ? `\n\nStill missing from this deal's reports — the person on the call wants these answered, so work them into the checklist and nudges when the moment fits:\n${params.toolGaps.map((g) => `- ${g.gap} (for the ${g.tool})`).join("\n")}`
    : "";
  const attachedFilesText = params.attachedFiles
    ? `\n\nFiles/voice notes attached to this deal ahead of the call:\n${params.attachedFiles}`
    : "";

  return `Deal: ${params.dealName || "Unnamed deal"}

What we know about this deal so far: ${params.dealMemory || "Nothing yet — this may be an early meeting."}

Decision boundaries / constraints for this deal: ${params.decisionBoundaries || "None recorded."}${leadStyleText}${notesText}${attachedFilesText}${pastMeetingsText}${emailContextText}${calendarContextText}${documentContextText}${feedbackText}${toolGapsText}${playbookLiveText(params.playbook)}`;
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
    priorOffLimits?: { label: string; raised: boolean }[] | null;
    // Answers already caught this call, so only new ones come back.
    priorAnswers?: LiveAnswer[] | null;
    // false = keep priorChecklist (and the off-limits list) as is this time, which keeps the reply
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

  const priorOffLimitsText = updateChecklist && params.priorOffLimits?.length
    ? `\n\nOff-limits list from the last update (keep these labels, just update raised):\n${params.priorOffLimits
        .map((c) => `- [${c.raised ? "raised" : " "}] ${c.label}`)
        .join("\n")}`
    : "";

  const system =
    "You are an expert coach sitting beside someone on a live call, watching the transcript stream in. Your job, in order: (1) catch what the other side asks or proposes that needs an answer, with a ready-to-say answer (questionAsked/question/suggestedAnswer); (2) catch what the other side answers: the facts this call needs to find out (answers); (3) keep the checklist current; (4) at most two small suggestions, only when they help right now. Ground everything in the transcript and what's known about this deal: its prep notes, decision boundaries, report gaps and past meetings. Never invent facts, numbers, commitments or objections; when something isn't known, say so plainly. Respect the decision boundaries in every answer. Keep everything short: the person is mid-conversation and glances at this.";

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
        : "Keep the checklist and the off-limits list as they are this time — leave both out of your reply."
    }${priorOffLimitsText}${
      params.priorAnswers?.length
        ? `\n\nAnswers caught so far (don't repeat these):\n${params.priorAnswers.map((a) => `- ${a.topic}: ${a.answer}`).join("\n")}`
        : ""
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
    answers?: unknown;
    offLimits?: unknown;
    answerCaution?: unknown;
    cautionReason?: unknown;
  };

  const returnedChecklist = Array.isArray(raw.checklist)
    ? raw.checklist.filter(
        (c): c is { label: string; covered: boolean } =>
          Boolean(c) && typeof c === "object" && typeof (c as { label?: unknown }).label === "string"
      )
    : [];

  return {
    nudges: Array.isArray(raw.nudges) ? raw.nudges.filter((n): n is string => typeof n === "string" && Boolean(n.trim())).slice(0, 2) : [],
    checklist: returnedChecklist.length && updateChecklist ? returnedChecklist : params.priorChecklist ?? [],
    liveQuestion: sanitizeLiveQuestion(raw),
    answers: Array.isArray(raw.answers)
      ? raw.answers
          .filter(
            (a): a is { topic: string; answer: string } =>
              Boolean(a) && typeof a === "object" && typeof (a as { topic?: unknown }).topic === "string" && typeof (a as { answer?: unknown }).answer === "string"
          )
          .map((a) => ({ topic: a.topic.trim().slice(0, 60), answer: a.answer.trim().slice(0, 200) }))
          .filter((a) => a.topic && a.answer)
          .slice(0, 5)
      : [],
    offLimits: updateChecklist && Array.isArray(raw.offLimits)
      ? raw.offLimits
          .filter(
            (c): c is { label: string; raised: unknown } =>
              Boolean(c) && typeof c === "object" && typeof (c as { label?: unknown }).label === "string"
          )
          .map((c) => ({ label: c.label, raised: c.raised === true }))
          .slice(0, 8)
      : params.priorOffLimits ?? [],
  };
}
