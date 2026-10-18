import { after } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { deals, meetingLiveSegments, meetings, users, type LiveCaution, type LiveQuestionRecord } from "@/db/schema";
import { canAccessDeal } from "@/lib/dealAccess";
import { loadLiveDealContextCached } from "@/lib/liveContext";
import { LIVE_MODEL, liveClient, liveDealContextText } from "@/lib/liveCoaching";
import { withAiUser } from "@/lib/aiUsage";
import { isSelfSpeaker, type CallIdentity } from "@/lib/callIdentity";
import { liveLinksFor, type LiveLink } from "@/lib/liveLinks";

// The instant path for "they just asked something": runs the moment a
// transcript line that looks like a question lands (from Recall's
// webhook or the desktop/mic live-transcript push), instead of waiting
// for the next periodic coaching refresh. The question shows in the
// panel within one poll with "working on an answer", and the answer is
// streamed into the panel as it's written (first words within a second
// or so) instead of appearing only once the whole reply is done — far
// quicker than the full nudges + checklist regeneration, which still
// runs on its own cadence and still catches questions this misses.

const TRANSCRIPT_WINDOW_CHARS = 3_000;
const ANSWER_MAX_TOKENS = 400;
// How often a partially-written answer is pushed to the panel while it
// streams in. The client polls faster while an answer is being written
// (see useLiveMeeting.ts), so this is what the rep sees "typing".
const STREAM_FLUSH_MS = 200;
// The same question coming in twice (a desktop retry, the speaker
// repeating it a moment later) shouldn't restart the answer.
const DUPLICATE_WINDOW_MS = 20_000;
// The answer model replies with exactly this when the line wasn't a real
// question needing an answer (rhetorical, small talk, "you know?").
const NOT_A_QUESTION = "NONE";

const LEADING_FILLER = /^(?:so|and|but|okay|ok|um+|uh+|er+|hmm+|well|right|yeah|yes|no|also|then|just|actually|now|hey|alright|look|sure|great|cool|got it|i see|makes sense)\b[\s,]*/i;
const QUESTION_START =
  /^(?:what|what's|whats|how|how's|hows|why|when|where|who|who's|whose|which|can|could|would|will|won't|do|does|did|don't|doesn't|didn't|is|isn't|are|aren't|was|were|should|shall|have|has|haven't|any|tell me|walk me|explain|talk me|help me understand|remind me)\b/i;
// Questions buried mid-utterance, or asked indirectly ("I'm curious how
// you handle SSO"), which the browser mic's unpunctuated speech-to-text
// in particular produces all the time. Matched anywhere in the line;
// each needs two words so a lone "what" or "how" inside a statement
// doesn't count.
const EMBEDDED_QUESTION =
  /\b(?:how (?:much|many|long|soon|fast|often|does|do|did|would|will|can|could|is|are|should)|what (?:is|are|does|do|did|would|will|about|if|happens|kind|sort|type|level|options|timeline|price|pricing)|what's (?:the|your|our)|why (?:does|do|did|would|is|are|should)|when (?:can|will|would|do|does|did|is|are|should)|where (?:do|does|is|are|can|would)|who (?:is|are|would|will|else|owns|handles)|which (?:one|plan|option|version|tier)|do you (?:have|offer|support|guys|integrate|work|provide|handle|do|charge|think)|does (?:it|that|this|your)|can (?:you|we|it|i)|could (?:you|we|it)|would (?:you|it|that)|will (?:you|it|that|there)|is (?:there|it|that|this) (?:possible|included|something|a|an|any|going)|are (?:there|you|we) (?:able|planning|going|any)|i(?:'m| am| was) (?:wondering|curious)|i'd (?:like|love) to (?:know|understand|hear)|tell me (?:about|more|how|what|why|when)|walk (?:me|us) through|help (?:me|us) understand|any (?:idea|thoughts|update|chance|plans))\b/i;
// "I know how…", "no matter what…" — a question word inside a statement.
const STATEMENT_LEAD_IN =
  /\b(?:i|we|they|you|he|she) (?:know|knew|see|saw|understand|get|remember|told|showed|explained|decided|figured out|learned)\s*$|\b(?:no matter|regardless of|depends on|that's|thats|which is|exactly)\s*$/i;
// Short tag questions that aren't asking anything.
const NOT_REALLY_ASKING = /^(?:right|you know|okay|ok|yeah|correct|make sense|makes sense|see|huh|really|no|yes|sorry|pardon|what|hello|anyone|can you hear me|can you see my screen|you there|am i on mute)\??$/i;

function stripFiller(text: string): string {
  let out = text.trim();
  for (let i = 0; i < 3; i++) out = out.replace(LEADING_FILLER, "");
  return out;
}

// Cheap, instant check — no AI. Finds the question in a finalized
// utterance: a sentence ending in "?" (Recall's streaming ASR
// punctuates), one that opens like a question once filler is stripped,
// or — for the browser mic's unpunctuated speech-to-text, which often
// runs a statement and a question together — a question phrase anywhere
// in the line. Deliberately generous: the answer call itself discards
// anything that turns out not to be a real question, and it sees the
// surrounding transcript to complete a question cut across two lines.
export function extractQuestion(text: string): string | null {
  const sentences = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return null;

  // Questions near the end of the line matter most — that's what's still
  // hanging when the speaker stops talking.
  for (let i = sentences.length - 1; i >= 0; i--) {
    const sentence = sentences[i];
    if (!sentence.endsWith("?")) continue;
    const core = stripFiller(sentence.replace(/\?+$/, ""));
    if (!core || NOT_REALLY_ASKING.test(core)) continue;
    // "For the enterprise tier?" — a fragment; carry the sentence before
    // it along so the question makes sense on screen.
    if (core.split(/\s+/).length < 5 && i > 0 && !QUESTION_START.test(core)) {
      return `${sentences[i - 1]} ${sentence}`;
    }
    return sentence;
  }

  // Everything below is for lines without a "?" — a punctuated line
  // whose only question was a filler ("Can you hear me?") stops here.
  const unpunctuated = sentences.filter((s) => !s.endsWith("?"));
  if (!unpunctuated.length || sentences[sentences.length - 1].endsWith("?")) return null;

  const last = stripFiller(unpunctuated[unpunctuated.length - 1]);
  if (QUESTION_START.test(last) && last.split(/\s+/).length >= 3) return last;

  // Unpunctuated speech: look for a question phrase in the last couple of
  // sentences and take it from there to the end — unless it's plainly part
  // of a statement ("I know how much work that is").
  const tail = unpunctuated.slice(-2).join(" ");
  const match = EMBEDDED_QUESTION.exec(tail);
  if (match && !STATEMENT_LEAD_IN.test(tail.slice(0, match.index))) {
    const candidate = tail.slice(match.index).trim();
    if (candidate.split(/\s+/).length >= 3) return candidate;
  }
  return null;
}

// The call's questions kept for the live panel's list (newest last).
const MAX_QUESTION_HISTORY = 30;

// Last question started per meeting, to skip an immediate duplicate.
const recentQuestions = new Map<string, { key: string; at: number }>();

function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// The in-person mic sends a question twice — once from the paused
// in-progress line, once when the browser finalizes it, often with a
// word or two changed — so match loosely rather than exactly.
function sameQuestion(a: string, b: string): boolean {
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  const wordsA = new Set(a.split(" "));
  const wordsB = b.split(" ");
  const shared = wordsB.filter((w) => wordsA.has(w)).length;
  return shared / Math.max(wordsA.size, wordsB.length) >= 0.75;
}

// Called right after a live transcript line is stored. Returns
// immediately; the work runs after the response is sent (Next's after())
// so the transcript webhook/push stays fast.
export function onLiveSegment(meetingId: string, text: string, speakerName: string | null) {
  const question = extractQuestion(text);
  if (!question) return;
  const key = normalizeQuestion(question);
  const previous = recentQuestions.get(meetingId);
  if (previous && Date.now() - previous.at < DUPLICATE_WINDOW_MS && sameQuestion(previous.key, key)) return;
  recentQuestions.set(meetingId, { key, at: Date.now() });
  if (recentQuestions.size > 500) recentQuestions.clear();
  after(() =>
    answerLiveQuestion(meetingId, question, speakerName).catch((err) => {
      console.error(`[live question] failed for meeting ${meetingId}:`, err);
    })
  );
}

const EMPTY_SUGGESTIONS = sql`'{"nudges":[],"checklist":[],"liveQuestion":null}'::jsonb`;

// Only writes if the panel is still showing this exact question — a newer
// question (or the coaching refresh clearing it) wins over a late answer.
function stillCurrent(meetingId: string, askedAt: number) {
  return and(
    eq(meetings.id, meetingId),
    sql`${meetings.liveSuggestions}->'liveQuestion'->>'askedAt' = ${String(askedAt)}`
  );
}

type LiveQuestionValue = {
  question: string;
  suggestedAnswer: string;
  askedAt: number;
  answering?: boolean;
  askedBy?: string | null;
  links?: LiveLink[];
  caution?: LiveCaution | null;
};

function writeQuestion(meetingId: string, askedAt: number, value: LiveQuestionValue) {
  return db
    .update(meetings)
    .set({
      liveSuggestions: sql`${meetings.liveSuggestions} || jsonb_build_object('liveQuestion', ${JSON.stringify(value)}::jsonb)`,
    })
    .where(stillCurrent(meetingId, askedAt))
    .returning({ id: meetings.id });
}

// The model's reply opens with a few header lines, then the answer:
//   WHO: client | rep        — who asked, judged from what was asked
//   FLAG: none | amber: why | red: why
//   Q: <the question, completed from context>
// so a question the rep asked is dropped the moment WHO arrives, a
// question that touches what the person on the call can't agree to is
// flagged on screen, and a question cut across two transcript lines (or
// mangled by speech-to-text) shows up whole and readable.
type ParsedReply = {
  question: string | null;
  answer: string;
  notAQuestion: boolean;
  // Dropped because the rep asked it (WHO: rep), as opposed to not being
  // a real question at all.
  askedByRep?: boolean;
  caution: LiveCaution | null;
};

const HEADER_LINE = /^(WHO|FLAG|Q):[ \t]*(.*?)(?:\n|$)/i;

export function parseReply(raw: string): ParsedReply {
  let text = raw.replace(/^\s+/, "");
  if (text.toUpperCase().startsWith(NOT_A_QUESTION)) return { question: null, answer: "", notAQuestion: true, caution: null };
  let question: string | null = null;
  let caution: LiveCaution | null = null;
  let sawHeader = false;
  for (let m = HEADER_LINE.exec(text); m; m = HEADER_LINE.exec(text)) {
    sawHeader = true;
    const key = m[1].toUpperCase();
    const value = m[2].trim();
    if (key === "WHO" && /^(rep|seller|us|me)\b/i.test(value)) {
      return { question: null, answer: "", notAQuestion: true, askedByRep: true, caution: null };
    }
    if (key === "FLAG") caution = parseCaution(value);
    if (key === "Q") question = value || null;
    text = text.slice(m[0].length).replace(/^\s+/, "");
  }
  // A header line still being written: nothing to show from it yet.
  const partial = text.toUpperCase();
  if (
    /^(WHO|FLAG|Q):/i.test(text) ||
    (!sawHeader && partial.length < 5 && ["WHO:", "FLAG:", NOT_A_QUESTION].some((h) => h.startsWith(partial)))
  ) {
    return { question, answer: "", notAQuestion: false, caution };
  }
  if (text.toUpperCase().startsWith(NOT_A_QUESTION) && !question) {
    return { question: null, answer: "", notAQuestion: true, caution: null };
  }
  return { question, answer: text.replace(/^A:\s*/i, "").trim(), notAQuestion: false, caution };
}

function parseCaution(value: string): LiveCaution | null {
  const m = /^(red|amber|yellow|orange)\b[\s:—–-]*(.*)$/i.exec(value);
  if (!m) return null;
  return { level: /^red$/i.test(m[1]) ? "red" : "amber", reason: m[2].trim().slice(0, 140) };
}

// What the answer call has worked out about each named speaker on a
// call: how often a line of theirs read as the rep's vs the client's.
// Given back to the next question's prompt, so a name the account
// doesn't match (a device name, a nickname) still gets recognized as the
// rep after a question or two. In memory only — it's a hint, not data.
const speakerRoles = new Map<string, Map<string, { rep: number; client: number }>>();

function noteSpeakerRole(meetingId: string, speaker: string | null, role: "rep" | "client") {
  if (!speaker) return;
  let roles = speakerRoles.get(meetingId);
  if (!roles) {
    if (speakerRoles.size > 300) speakerRoles.clear();
    roles = new Map();
    speakerRoles.set(meetingId, roles);
  }
  const votes = roles.get(speaker) ?? { rep: 0, client: 0 };
  votes[role]++;
  roles.set(speaker, votes);
}

function likelyRole(meetingId: string, speaker: string): "rep" | "client" | null {
  const votes = speakerRoles.get(meetingId)?.get(speaker);
  if (!votes) return null;
  if (votes.rep >= 2 && votes.rep > votes.client * 2) return "rep";
  if (votes.client >= 1 && votes.client > votes.rep) return "client";
  return null;
}

async function answerLiveQuestion(meetingId: string, question: string, speakerName: string | null) {
  const [row] = await db
    .select({ meeting: meetings, ownerName: users.name, ownerEmail: users.email, ownerCallNames: users.callNames })
    .from(meetings)
    .leftJoin(users, eq(users.id, meetings.userId))
    .where(eq(meetings.id, meetingId));
  if (!row) return;
  const { meeting, ownerName } = row;
  if (meeting.status !== "joining" && meeting.status !== "recording") return;
  const me: CallIdentity = { name: ownerName, email: row.ownerEmail, callNames: row.ownerCallNames };
  // The rep asking their own question isn't something to answer for them.
  // Only checkable when the line has a speaker (bot/desktop calls); the
  // in-person mic has none, and the answer call screens those instead.
  if (isSelfSpeaker(speakerName, me)) return;
  // Nor is one from a speaker this call has already shown to be the rep
  // (by what they asked earlier), even when their label isn't their name.
  if (speakerName && likelyRole(meetingId, speakerName) === "rep") return;

  // Show the question right away — the panel renders it with "working on
  // an answer" while the answer streams in below. Loaded alongside
  // everything the answer needs rather than one after another.
  const askedAt = Date.now();
  const pending = { question, suggestedAnswer: "", askedAt, answering: true };
  const showPending = db
    .update(meetings)
    .set({
      liveSuggestions: sql`coalesce(${meetings.liveSuggestions}, ${EMPTY_SUGGESTIONS}) || jsonb_build_object('liveQuestion', ${JSON.stringify(pending)}::jsonb)`,
    })
    .where(eq(meetings.id, meetingId));

  const loadDeal = async () => {
    if (!meeting.dealId) return null;
    const [deal] = await db.select().from(deals).where(eq(deals.id, meeting.dealId));
    // Same rule as the live route: a meeting's dealId isn't guaranteed to
    // be one its owner can access, so never pull in another team's deal facts.
    if (!deal || !(await canAccessDeal(meeting.userId, deal.id, deal.teamId, deal))) return null;
    return deal;
  };

  let deal: typeof deals.$inferSelect | null = null;
  const [, context, segments] = await Promise.all([
    showPending,
    loadDeal().then((d) => {
      deal = d;
      return loadLiveDealContextCached(meetingId, d);
    }),
    db
      .select({ speakerName: meetingLiveSegments.speakerName, text: meetingLiveSegments.text })
      .from(meetingLiveSegments)
      .where(eq(meetingLiveSegments.meetingId, meetingId))
      .orderBy(asc(meetingLiveSegments.createdAt)),
  ]);
  const roleTag = (name: string) => {
    if (isSelfSpeaker(name, me)) return " (the rep)";
    const role = likelyRole(meetingId, name);
    return role === "rep" ? " (probably the rep)" : role === "client" ? " (probably the client side)" : "";
  };
  const transcript = segments
    .map((s) => (s.speakerName ? `${s.speakerName}${roleTag(s.speakerName)}: ${s.text}` : s.text))
    .join("\n")
    .slice(-TRANSCRIPT_WINDOW_CHARS);

  const instructions = `You help the person representing the seller on a live sales call (the "rep" — the deal owner or a teammate covering for them) answer what the other side (the client/prospect) just asked. Speed matters: reply straight away, nothing extra.

Reply in exactly this format:
WHO: client or rep
FLAG: none | amber: <why, max 8 words> | red: <why, max 8 words>
Q: <the question as they meant it, one short line — complete it from the transcript if it was cut off or split across lines, and fix obvious speech-to-text mistakes>
<the answer: 1-3 short sentences the rep can say almost word for word — no preamble, no quotes, no labels>

WHO — decide from WHAT was asked and how, not from names: speaker labels are often missing (an in-person recording has none), wrong, or a device name. The rep sells; the client buys.
- Client questions are about the seller's side: the product, features, how it works, pricing, discounts, setup/onboarding, integrations, security/compliance, contract terms, support, references, delivery dates ("do you…", "can your tool…", "how much is…", "what does it cost…", "is it secure…").
- Rep questions are discovery and steering: about the client's business, team, current tools, process, pain points, budget, decision makers, timeline, next steps ("how do you currently…", "who else is involved…", "what's your budget…", "does Tuesday work?"), or the rep repeating/reading out the client's question.
- Use the conversation too: whoever explains the product is the rep; whoever describes their own company's problems is the client. Lines tagged "(the rep)" are the rep's; "(probably …)" tags are earlier guesses.
If WHO is rep, stop after the WHO line.

FLAG — check the question against the deal's decision boundaries and prep notes:
- red: a straight answer would agree to, promise, or disclose something the rep isn't allowed to decide or discuss (e.g. a discount past the limit, custom work, contract or legal terms, roadmap dates, anything the boundaries rule out). The answer must NOT agree — give a polite, confident line that defers it ("Let me take that back to <owner/team> and come back to you by tomorrow") without saying "I'm not allowed".
- amber: the answer depends on something not in the facts given, or touches a commitment (price, dates, security claims) the boundaries don't cover — answer carefully and suggest confirming after the call.
- none: everything else.

The answer: ground it only in the deal facts and transcript. Be specific and use real numbers and names from the facts when they answer the question. If the real answer isn't known, say so plainly and offer to follow up — never invent a number, date, feature, or commitment.

Reply with exactly ${NOT_A_QUESTION} and nothing else if it isn't a real question needing an answer (rhetorical, small talk, "you know?", "can you hear me?") or it was already answered in the transcript.`;

  const stream = withAiUser({ userId: meeting.userId, meetingId }, () => liveClient("live_questions").messages.stream({
    model: LIVE_MODEL,
    max_tokens: ANSWER_MAX_TOKENS,
    // The deal facts are the same for every question in this call, so
    // they're cached after the first one — later questions skip
    // re-reading them, which cuts time to first word.
    system: [
      { type: "text", text: instructions },
      { type: "text", text: liveDealContextText(context), cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: `Recent transcript:
${transcript || "(nothing transcribed yet)"}

The line that looked like a question${speakerName ? ` (speaker label: ${speakerName}${roleTag(speakerName)})` : " (no speaker label)"}: "${question}"`,
      },
    ],
  }));

  let raw = "";
  let lastFlush = 0;
  let flushing: Promise<unknown> = Promise.resolve();
  let superseded = false;
  const flush = (final: boolean) => {
    const parsed = parseReply(raw);
    if (parsed.notAQuestion || (!final && !parsed.answer)) return;
    lastFlush = Date.now();
    const value = {
      question: parsed.question || question,
      suggestedAnswer: parsed.answer,
      askedAt,
      caution: parsed.caution,
      ...(final ? {} : { answering: true }),
    };
    flushing = flushing
      .then(() => writeQuestion(meetingId, askedAt, value))
      .then((rows) => {
        // A newer question (or the coaching refresh) replaced this one —
        // stop paying for an answer nobody will see.
        if (!rows.length && !final) {
          superseded = true;
          stream.abort();
        }
      });
  };

  stream.on("text", (delta) => {
    raw += delta;
    if (parseReply(raw).notAQuestion) {
      stream.abort();
      return;
    }
    if (Date.now() - lastFlush >= STREAM_FLUSH_MS) flush(false);
  });

  try {
    await stream.finalMessage();
  } catch (err) {
    if (superseded || parseReply(raw).notAQuestion) {
      // Aborted on purpose — handled below.
    } else {
      throw err;
    }
  }
  await flushing;
  if (superseded) return;

  const parsed = parseReply(raw);
  if (parsed.askedByRep) noteSpeakerRole(meetingId, speakerName, "rep");
  if (parsed.notAQuestion || !parsed.answer) {
    await db
      .update(meetings)
      .set({ liveSuggestions: sql`${meetings.liveSuggestions} || '{"liveQuestion":null}'::jsonb` })
      .where(stillCurrent(meetingId, askedAt));
    return;
  }
  noteSpeakerRole(meetingId, speakerName, "client");
  const finalQuestion = parsed.question || question;
  const links = await liveLinksFor({
    userId: meeting.userId,
    deal,
    askedBy: speakerName,
    texts: [finalQuestion, parsed.answer],
  }).catch((err) => {
    console.error("[live question] couldn't build links:", err);
    return [];
  });
  flushing = flushing.then(() =>
    writeQuestion(meetingId, askedAt, {
      question: finalQuestion,
      suggestedAnswer: parsed.answer,
      askedAt,
      askedBy: speakerName,
      links,
      caution: parsed.caution,
    })
  );
  await flushing;
  await saveToHistory(meetingId, {
    question: finalQuestion,
    answer: parsed.answer,
    askedAt,
    askedBy: speakerName,
    links,
    caution: parsed.caution,
  });
}

// Appends an answered question to the meeting's list, which the panel
// shows under the current one so earlier answers don't vanish.
async function saveToHistory(meetingId: string, record: LiveQuestionRecord) {
  await db
    .update(meetings)
    .set({
      liveQuestions: sql`(
        select coalesce(jsonb_agg(q order by (q->>'askedAt')::bigint), '[]'::jsonb) from (
          select q from jsonb_array_elements(coalesce(${meetings.liveQuestions}, '[]'::jsonb) || ${JSON.stringify([record])}::jsonb) q
          order by (q->>'askedAt')::bigint desc limit ${MAX_QUESTION_HISTORY}
        ) recent
      )`,
    })
    .where(eq(meetings.id, meetingId));
}
