import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, meetingLiveSegments, deals, users } from "@/db/schema";
import { and, eq, asc, isNull, sql } from "drizzle-orm";
import { generateLiveCoaching, describeCoachingError, type LiveCoaching } from "@/lib/liveCoaching";
import { canAccessDeal } from "@/lib/dealAccess";
import { loadLiveDealContextCached } from "@/lib/liveContext";
import { authenticateBearer } from "@/lib/apiToken";
import { reconcileBotMeeting } from "@/lib/botReconcile";
import { withAiUser } from "@/lib/aiUsage";
import { isSelfSpeaker } from "@/lib/callIdentity";
import { saveToHistory } from "@/lib/liveQuestion";
import { noteLivePoll } from "@/lib/stuckMeetings";

// When live coaching (nudges + checklist) regenerates. It used to run on
// a flat 8s timer whether or not anyone had said anything, so a new
// point in the conversation could wait up to 8s just to be looked at.
// Now: as soon as new speech has arrived since the last refresh started
// (at most once per MIN_REFRESH_MS), plus a slower heartbeat during
// silence so nudges grounded in prep notes still keep current. Still one
// refresh at a time per meeting no matter how many tabs poll (the soft
// lock + inFlight below). Questions don't wait for any of this — they
// have their own instant path (src/lib/liveQuestion.ts).
// Was 1.5s/15s, which regenerated suggestions after almost every line —
// about 80% of what a member's AI usage cost. Nudges don't need to change
// every second (questions have their own instant path), so refresh at
// most every 8s while people talk, and every 30s in silence.
// Live calls now run on Haiku 5.5, about a tenth of Haiku 4.5's price, so
// suggestions can keep up twice as quickly for less than before.
const MIN_REFRESH_MS = 4_000;
const IDLE_REFRESH_MS = 20_000;
// The checklist is the longest part of each reply and only changes when a
// topic gets covered, so it's only rewritten this often; refreshes in
// between keep the current one.
const CHECKLIST_REFRESH_MS = 30_000;
const lastChecklistAt = new Map<string, number>();
// How much of the transcript (from the end) to hand the model each time,
// in characters — enough context without an ever-growing prompt as a
// long call goes on.
const TRANSCRIPT_WINDOW_CHARS = 4_000;
// How long an answered question stays up before a coaching refresh that
// no longer sees it as open may clear it. Was 15s, which often took the
// answer away before the rep had finished reading it out. A newer
// question still replaces it straight away, and every answer stays in
// the call's question list either way.
const QUESTION_HOLD_MS = 120_000;
// Suggestions used to be swapped wholesale on every refresh (every ~8s
// while people talk), so one could vanish mid-read. Now each stays at
// least this long, with new ones added on top, up to MAX_NUDGES.
const NUDGE_HOLD_MS = 90_000;
const MAX_NUDGES = 4;
// Why the most recent coaching refresh failed, per meeting — only the
// request that wins the refresh lock actually sees the error, so it's
// kept here for every other poll (and tab) to report until a refresh
// succeeds. In-memory is enough: it's a status hint, not data, and a
// restart just means the next refresh re-discovers it.
const lastCoachingError = new Map<string, string>();
// Meetings with a coaching refresh currently running in this process —
// refreshes now run in the background (after the poll responds), so
// without this a slow AI call could overlap the next one and the two
// would race to write.
const inFlight = new Set<string>();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  // Also accepts the desktop app's bearer token — its floating overlay
  // (see desktop/src/main.ts's showOverlay) loads the Focus window
  // instead of a browser tab, and that window polls this same route for
  // its live transcript + coaching the same way the During tab does.
  const bearerUserId = session?.user?.id ? null : await authenticateBearer(req);
  const userId = session?.user?.id ?? bearerUserId;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  after(() => reconcileBotMeeting(meeting));
  // Someone's still on this call (see stuckMeetings.ts).
  noteLivePoll(id);
  const isOwner = meeting.userId === userId;
  const dealRows = meeting.dealId
    ? await db.select().from(deals).where(eq(deals.id, meeting.dealId))
    : [];
  let deal: typeof deals.$inferSelect | null = dealRows[0] ?? null;

  // A meeting's dealId isn't guaranteed to be one this user actually has
  // access to (see the root-cause note in meetings/route.ts) — this used
  // to only get checked for a non-owner, so the owner's own meeting could
  // pull another team's deal memory/notes/decision boundaries/email and
  // calendar context straight into live coaching with no check at all.
  const canUseDeal = Boolean(deal && (await canAccessDeal(userId, deal.id, deal.teamId, deal)));
  if (!isOwner && !canUseDeal) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  if (!canUseDeal) {
    deal = null;
  }

  const rawSegments = await db
    .select()
    .from(meetingLiveSegments)
    .where(eq(meetingLiveSegments.meetingId, id))
    .orderBy(asc(meetingLiveSegments.createdAt));
  // Segments are written from two independent, network-dependent paths
  // (Recall's webhook for bot calls, the desktop app's live-transcript
  // push for desktop recordings) that don't guarantee arrival order
  // matches speech order — a retried delivery can land after a later
  // line. relativeSeconds reflects true call-relative timing when it's
  // present, so re-sort by that where both sides have it; segments
  // missing it (or being compared to one that is) keep the createdAt
  // (arrival) order the query above already gave them, via a stable
  // sort's guarantee that a `0` comparison leaves relative order intact.
  const segments = [...rawSegments].sort((a, b) => {
    if (a.relativeSeconds != null && b.relativeSeconds != null) {
      return a.relativeSeconds - b.relativeSeconds;
    }
    return 0;
  });

  const liveSuggestions = meeting.liveSuggestions;

  const isLive = meeting.status === "joining" || meeting.status === "recording";
  const transcriptText = segments
    .map((s) => (s.speakerName ? `${s.speakerName}: ${s.text}` : s.text))
    .join("\n");
  // liveSuggestionsUpdatedAt is stamped when a refresh STARTS (the lock
  // below), so anything that arrived after it hasn't been coached on yet.
  const lastRefreshAt = meeting.liveSuggestionsUpdatedAt?.getTime() ?? 0;
  const sinceRefresh = Date.now() - lastRefreshAt;
  const hasNewSpeech = rawSegments.some((s) => s.createdAt.getTime() > lastRefreshAt);
  // Keeps running even before the first words are transcribed — there's
  // usually plenty already known about the deal (prep notes, decision
  // boundaries, last meeting) to coach on from the very start of a call.
  const dueForRefresh =
    isLive &&
    !inFlight.has(id) &&
    (!meeting.liveSuggestionsUpdatedAt ||
      (hasNewSpeech && sinceRefresh > MIN_REFRESH_MS) ||
      sinceRefresh > IDLE_REFRESH_MS);

  if (dueForRefresh) {
    // Soft lock: stamp the timestamp before the (slow) AI call so a
    // second poll landing a moment later doesn't kick off a duplicate
    // generation for the same window. This has to be a compare-and-swap
    // (only update if liveSuggestionsUpdatedAt still matches what THIS
    // request read) rather than an unconditional update — the During tab
    // and the Focus window/overlay both poll this route independently on
    // similar cadences, and an unconditional update let two requests that
    // both read the same stale timestamp both "win" the lock and both
    // fire a full generateLiveCoaching call. The .returning() row is only
    // present if this request's WHERE actually matched, i.e. actually won.
    const startedAt = new Date();
    const [wonLock] = await db
      .update(meetings)
      .set({ liveSuggestionsUpdatedAt: startedAt })
      .where(
        and(
          eq(meetings.id, id),
          meeting.liveSuggestionsUpdatedAt
            ? eq(meetings.liveSuggestionsUpdatedAt, meeting.liveSuggestionsUpdatedAt)
            : isNull(meetings.liveSuggestionsUpdatedAt)
        )
      )
      .returning({ id: meetings.id });

    // !wonLock means another concurrent poll already claimed this refresh
    // cycle. Otherwise the AI call runs after this response is sent, so
    // the poll that triggers it isn't stuck waiting seconds for the model
    // (it used to freeze the live transcript for that tab meanwhile); the
    // result shows up on the next poll, about a second later.
    if (wonLock) {
      inFlight.add(id);
      const priorChecklist = meeting.liveSuggestions?.checklist || null;
      const updateChecklist =
        !priorChecklist?.length || Date.now() - (lastChecklistAt.get(id) ?? 0) >= CHECKLIST_REFRESH_MS;
      if (updateChecklist) lastChecklistAt.set(id, Date.now());
      if (lastChecklistAt.size > 500) lastChecklistAt.clear();
      after(async () => {
        try {
          const context = await loadLiveDealContextCached(id, deal);
          // Charged to the meeting's owner, whichever tab or window's
          // poll happened to trigger it (see aiUsage.ts).
          const coaching = await withAiUser({ userId: meeting.userId, meetingId: id }, () => generateLiveCoaching({
            ...context,
            recentTranscript: transcriptText.slice(-TRANSCRIPT_WINDOW_CHARS),
            priorChecklist,
            priorOffLimits: meeting.liveSuggestions?.offLimits ?? null,
            updateChecklist,
          }));
          await saveCoaching(id, coaching, startedAt.getTime());
          lastCoachingError.delete(id);
        } catch (err) {
          lastCoachingError.set(id, describeCoachingError(err));
          // Live coaching is a nice-to-have layered on top of the live
          // transcript, which still works fine on its own — never fail the
          // poll (and the transcript feed with it) over a coaching hiccup.
          console.error(`[live coaching] failed for meeting ${id}:`, err);
        } finally {
          inFlight.delete(id);
        }
      });
    }
  }

  return NextResponse.json({
    status: meeting.status,
    isLive,
    // Whether this is a Zoom/Teams call Anchor's bot actually joined
    // (recallBotId set) vs. an in-person recording — the Stop button
    // only makes sense for the former (it tells Recall's bot to leave a
    // call; there's no such thing to tell an in-person recording, which
    // stops from its own Record-in-person control instead). See
    // LiveMeetingPanel.tsx and FocusWindow.tsx.
    hasBot: Boolean(meeting.recallBotId),
    // Anchor Desktop recordings stop from the desktop app itself; every
    // other live meeting (bot or in-person) can be stopped from the web.
    isDesktop: Boolean(meeting.recallRecordingId),
    // Stop was pressed on the website for this desktop recording — the
    // desktop app stops when it sees this.
    // Still true after the website has moved the meeting on, until its
    // recording has arrived.
    stopRequested:
      Boolean(meeting.stopRequestedAt) && !meeting.audioStoragePath && (isLive || meeting.status === "uploaded"),
    segments: segments.map((s) => ({
      id: s.id,
      speakerName: s.speakerName,
      text: s.text,
      relativeSeconds: s.relativeSeconds,
    })),
    liveSuggestions,
    // What the deal owner said a teammate covering this call may and may
    // not decide — shown as-is until coaching has turned it into the
    // "Don't agree to" list (liveSuggestions.offLimits).
    decisionBoundaries: deal?.decisionBoundaries?.trim() || null,
    // Every question answered so far this call, oldest first.
    liveQuestions: meeting.liveQuestions ?? [],
    // Who's speaking on this call, and which of them is the meeting's
    // owner, for the panel's "That's me" control. Empty for an in-person
    // recording, which has no speaker labels.
    speakers: await speakersOnCall(meeting.userId, segments),
    // Shown in place of "Preparing suggestions…" so a broken key/model
    // says so instead of looking like it's still loading forever.
    coachingError: isLive ? lastCoachingError.get(id) ?? null : null,
    // True while new suggestions are being generated — the panel shows
    // an "updating" hint so the rep can see Anchor is reacting.
    coachingRefreshing: isLive && inFlight.has(id),
  });
}

async function speakersOnCall(ownerId: string, segments: { speakerName: string | null }[]) {
  const names = [...new Set(segments.map((s) => s.speakerName).filter((n): n is string => Boolean(n)))];
  if (!names.length) return [];
  const [owner] = await db
    .select({ name: users.name, email: users.email, callNames: users.callNames })
    .from(users)
    .where(eq(users.id, ownerId));
  return names.map((name) => ({ name, isMe: owner ? isSelfSpeaker(name, owner) : false }));
}

// Keeps suggestions still worth reading on screen: the refresh's new
// ones first, then earlier ones shown less than NUDGE_HOLD_MS ago that it
// didn't repeat. nudgeAt (parallel to nudges) is when each first showed.
function mergeNudges(
  fresh: string[],
  prior: { nudges?: string[]; nudgeAt?: number[] } | null | undefined,
  now: number
) {
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const priorAt = new Map<string, number>();
  (prior?.nudges ?? []).forEach((n, i) => priorAt.set(key(n), prior?.nudgeAt?.[i] ?? now));
  const out: { text: string; at: number }[] = [];
  const seen = new Set<string>();
  for (const n of fresh) {
    if (seen.has(key(n))) continue;
    seen.add(key(n));
    out.push({ text: n, at: priorAt.get(key(n)) ?? now });
  }
  (prior?.nudges ?? []).forEach((n, i) => {
    const at = prior?.nudgeAt?.[i] ?? now;
    if (!seen.has(key(n)) && now - at < NUDGE_HOLD_MS) {
      seen.add(key(n));
      out.push({ text: n, at });
    }
  });
  const kept = out.slice(0, MAX_NUDGES);
  return { nudges: kept.map((n) => n.text), nudgeAt: kept.map((n) => n.at) };
}

// Writes a coaching refresh without clobbering a question the instant
// path (liveQuestion.ts) put up meanwhile. Re-reads the current row
// first since that path writes to the same column independently.
async function saveCoaching(id: string, coaching: LiveCoaching, startedAt: number) {
  const [current] = await db
    .select({ liveSuggestions: meetings.liveSuggestions })
    .from(meetings)
    .where(eq(meetings.id, id));
  const now = Date.now();
  const existing = current?.liveSuggestions?.liveQuestion ?? null;
  const merged = { ...coaching, ...mergeNudges(coaching.nudges, current?.liveSuggestions, now) };

  // An answer on screen stays until a newer question replaces it, or it's
  // been up QUESTION_HOLD_MS and coaching no longer sees anything open.
  // One coaching itself spotted (no askedAt yet) is stamped now so the
  // same rule applies to it.
  const existingIsFresh =
    existing != null &&
    (existing.askedAt == null ? false : existing.askedAt > startedAt || now - existing.askedAt < QUESTION_HOLD_MS);
  let liveQuestion: typeof existing = coaching.liveQuestion
    ? { ...coaching.liveQuestion, askedAt: coaching.liveQuestion.askedAt ?? now }
    : null;
  if (existing && (existingIsFresh || (liveQuestion && existing.suggestedAnswer))) {
    // Still within its hold, or still an open question — keep the answer
    // already on screen rather than swapping in a reworded one mid-read.
    liveQuestion = existing;
  }

  if (liveQuestion === existing && existing) {
    // Keep whatever question is in the row at write time, not the copy
    // read above — the instant path may have streamed more of its answer
    // (or finished it) in between.
    const { liveQuestion: _ignored, ...rest } = merged;
    void _ignored;
    await db
      .update(meetings)
      .set({
        liveSuggestions: sql`${JSON.stringify(rest)}::jsonb || jsonb_build_object('liveQuestion', ${meetings.liveSuggestions}->'liveQuestion')`,
      })
      .where(eq(meetings.id, id));
    return;
  }

  await db
    .update(meetings)
    .set({ liveSuggestions: { ...merged, liveQuestion } })
    .where(eq(meetings.id, id));
  // A question only coaching caught goes in the call's question list
  // too, so its answer is still there once a newer one replaces it.
  if (liveQuestion && liveQuestion.askedAt === now) {
    await saveToHistory(
      id,
      { question: liveQuestion.question, answer: liveQuestion.suggestedAnswer, askedAt: now, askedBy: null, links: [], caution: liveQuestion.caution ?? null },
      null
    );
  }
}
