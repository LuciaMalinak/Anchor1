import { after } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { deals, meetingLiveSegments, meetings, users } from "@/db/schema";
import { canAccessDeal } from "@/lib/dealAccess";
import { loadLiveDealContext } from "@/lib/liveContext";
import { LIVE_MODEL, liveClient, liveDealContextText } from "@/lib/liveCoaching";

// The instant path for "they just asked something": runs the moment a
// transcript line that looks like a question lands (from Recall's
// webhook or the desktop/mic live-transcript push), instead of waiting
// for the next periodic coaching refresh. The question shows in the
// panel within one poll (~1s) with "working on an answer", and a short,
// dedicated answer call fills it in a couple of seconds later — far
// quicker than the full nudges + checklist regeneration, which still
// runs on its own cadence and still catches questions this misses.

const TRANSCRIPT_WINDOW_CHARS = 2_500;
const ANSWER_MAX_TOKENS = 300;
// The answer model replies with exactly this when the line wasn't a real
// question needing an answer (rhetorical, small talk, "you know?").
const NOT_A_QUESTION = "NONE";

const LEADING_FILLER = /^(?:so|and|but|okay|ok|um+|uh+|well|right|yeah|also|then|just|actually|now|hey|alright|look)\b[\s,]*/i;
const QUESTION_START =
  /^(?:what|what's|whats|how|how's|why|when|where|who|whose|which|can|could|would|will|do|does|did|is|are|was|were|should|shall|have|has|any|tell me|walk me|explain)\b/i;

// Cheap, instant check — no AI. Finds the question in a finalized
// utterance: a sentence ending in "?" (Recall's streaming ASR
// punctuates), or, for the browser mic's unpunctuated speech-to-text, a
// last sentence that opens like a question once filler is stripped.
// Deliberately generous: the answer call itself discards anything that
// turns out not to be a real question.
export function extractQuestion(text: string): string | null {
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  const asked = [...sentences].reverse().find((s) => s.trim().endsWith("?"));
  let candidate = asked?.trim();
  if (!candidate) {
    let last = sentences[sentences.length - 1]?.trim() ?? "";
    for (let i = 0; i < 3; i++) last = last.replace(LEADING_FILLER, "");
    if (!QUESTION_START.test(last)) return null;
    candidate = last;
  }
  // "Right?", "You know?", "Okay?" — too short to be a real question.
  if (candidate.split(/\s+/).length < 3) return null;
  return candidate;
}

function firstName(name: string | null | undefined): string {
  return (name || "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

// Called right after a live transcript line is stored. Returns
// immediately; the work runs after the response is sent (Next's after())
// so the transcript webhook/push stays fast.
export function onLiveSegment(meetingId: string, text: string, speakerName: string | null) {
  const question = extractQuestion(text);
  if (!question) return;
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

async function answerLiveQuestion(meetingId: string, question: string, speakerName: string | null) {
  const [row] = await db
    .select({ meeting: meetings, ownerName: users.name })
    .from(meetings)
    .leftJoin(users, eq(users.id, meetings.userId))
    .where(eq(meetings.id, meetingId));
  if (!row) return;
  const { meeting, ownerName } = row;
  if (meeting.status !== "joining" && meeting.status !== "recording") return;
  // The rep asking their own question isn't something to answer for them.
  // Only checkable when the line has a speaker (bot/desktop calls); the
  // in-person mic has none, and the answer call screens those instead.
  if (speakerName && ownerName && firstName(speakerName) === firstName(ownerName)) return;

  // Show the question right away — the panel renders it with "working on
  // an answer" while the answer call below runs.
  const askedAt = Date.now();
  const pending = { question, suggestedAnswer: "", askedAt };
  await db
    .update(meetings)
    .set({
      liveSuggestions: sql`coalesce(${meetings.liveSuggestions}, ${EMPTY_SUGGESTIONS}) || jsonb_build_object('liveQuestion', ${JSON.stringify(pending)}::jsonb)`,
    })
    .where(eq(meetings.id, meetingId));

  const dealRows = meeting.dealId ? await db.select().from(deals).where(eq(deals.id, meeting.dealId)) : [];
  let deal: typeof deals.$inferSelect | null = dealRows[0] ?? null;
  // Same rule as the live route: a meeting's dealId isn't guaranteed to be
  // one its owner can access, so never pull in another team's deal facts.
  if (deal && !(await canAccessDeal(meeting.userId, deal.id, deal.teamId, deal))) deal = null;

  const [context, segments] = await Promise.all([
    loadLiveDealContext(meetingId, deal),
    db
      .select({ speakerName: meetingLiveSegments.speakerName, text: meetingLiveSegments.text })
      .from(meetingLiveSegments)
      .where(eq(meetingLiveSegments.meetingId, meetingId))
      .orderBy(asc(meetingLiveSegments.createdAt)),
  ]);
  const transcript = segments
    .map((s) => (s.speakerName ? `${s.speakerName}: ${s.text}` : s.text))
    .join("\n")
    .slice(-TRANSCRIPT_WINDOW_CHARS);

  const message = await liveClient().messages.create({
    model: LIVE_MODEL,
    max_tokens: ANSWER_MAX_TOKENS,
    system: `You help a sales rep answer a question the other side just asked, live, mid-call. Reply with only a short, ready-to-say answer (1-3 sentences) the rep could say almost as-is — no preamble, no quotes, no labels. Ground it only in the deal facts and transcript given; if the real answer isn't something you know, say so plainly (e.g. "I don't have that number in front of me — let me follow up right after the call") rather than inventing a number, date, or commitment. Never commit to anything outside the deal's decision boundaries — suggest noting it and following up instead. If the line was asked by the rep${ownerName ? ` (${ownerName})` : ""}, or isn't a real question needing an answer (rhetorical, small talk, a filler like "you know?"), reply with exactly ${NOT_A_QUESTION}.`,
    messages: [
      {
        role: "user",
        content: `${liveDealContextText(context)}

Recent transcript:
${transcript || "(nothing transcribed yet)"}

The question just asked${speakerName ? ` by ${speakerName}` : ""}: "${question}"`,
      },
    ],
  });

  const answer = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  if (!answer || answer === NOT_A_QUESTION) {
    await db
      .update(meetings)
      .set({ liveSuggestions: sql`${meetings.liveSuggestions} || '{"liveQuestion":null}'::jsonb` })
      .where(stillCurrent(meetingId, askedAt));
    return;
  }

  const answered = { question, suggestedAnswer: answer, askedAt };
  await db
    .update(meetings)
    .set({
      liveSuggestions: sql`${meetings.liveSuggestions} || jsonb_build_object('liveQuestion', ${JSON.stringify(answered)}::jsonb)`,
    })
    .where(stillCurrent(meetingId, askedAt));
}
