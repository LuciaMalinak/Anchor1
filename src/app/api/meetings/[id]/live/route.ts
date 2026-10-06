import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, meetingLiveSegments, deals } from "@/db/schema";
import { and, eq, asc, isNull, sql } from "drizzle-orm";
import { generateLiveCoaching, describeCoachingError, type LiveCoaching } from "@/lib/liveCoaching";
import { canAccessDeal } from "@/lib/dealAccess";
import { loadLiveDealContextCached } from "@/lib/liveContext";
import { authenticateBearer } from "@/lib/apiToken";

// When live coaching (nudges + checklist) regenerates. It used to run on
// a flat 8s timer whether or not anyone had said anything, so a new
// point in the conversation could wait up to 8s just to be looked at.
// Now: as soon as new speech has arrived since the last refresh started
// (at most once per MIN_REFRESH_MS), plus a slower heartbeat during
// silence so nudges grounded in prep notes still keep current. Still one
// refresh at a time per meeting no matter how many tabs poll (the soft
// lock + inFlight below). Questions don't wait for any of this — they
// have their own instant path (src/lib/liveQuestion.ts).
// Was 3s/20s; the deal context is now cached and the deal facts are
// prompt-cached, so a refresh is cheap enough to run on nearly every new
// line.
const MIN_REFRESH_MS = 1_500;
const IDLE_REFRESH_MS = 15_000;
// How much of the transcript (from the end) to hand the model each time,
// in characters — enough context without an ever-growing prompt as a
// long call goes on.
const TRANSCRIPT_WINDOW_CHARS = 6_000;
// How long a question from the instant path is protected from being
// cleared by a coaching refresh that doesn't see it as open — long
// enough that a refresh racing the question doesn't make it flicker
// away, short enough that it does go once the rep has answered it.
const FAST_QUESTION_HOLD_MS = 15_000;
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
      after(async () => {
        try {
          const context = await loadLiveDealContextCached(id, deal);
          const coaching = await generateLiveCoaching({
            ...context,
            recentTranscript: transcriptText.slice(-TRANSCRIPT_WINDOW_CHARS),
            priorChecklist,
          });
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
    segments: segments.map((s) => ({
      id: s.id,
      speakerName: s.speakerName,
      text: s.text,
      relativeSeconds: s.relativeSeconds,
    })),
    liveSuggestions,
    // Shown in place of "Preparing suggestions…" so a broken key/model
    // says so instead of looking like it's still loading forever.
    coachingError: isLive ? lastCoachingError.get(id) ?? null : null,
    // True while new suggestions are being generated — the panel shows
    // an "updating" hint so the rep can see Anchor is reacting.
    coachingRefreshing: isLive && inFlight.has(id),
  });
}

// Writes a coaching refresh without clobbering a question the instant
// path (liveQuestion.ts) put up meanwhile. Re-reads the current row
// first since that path writes to the same column independently.
async function saveCoaching(id: string, coaching: LiveCoaching, startedAt: number) {
  const [current] = await db
    .select({ liveSuggestions: meetings.liveSuggestions })
    .from(meetings)
    .where(eq(meetings.id, id));
  const existing = current?.liveSuggestions?.liveQuestion ?? null;
  const fastQuestionIsFresh =
    existing?.askedAt != null &&
    (existing.askedAt > startedAt || Date.now() - existing.askedAt < FAST_QUESTION_HOLD_MS);

  let liveQuestion = coaching.liveQuestion;
  if (fastQuestionIsFresh) {
    // Asked after this refresh started, or too recently to judge — keep it.
    liveQuestion = existing;
  } else if (coaching.liveQuestion && existing?.suggestedAnswer) {
    // Still an open question — keep the answer already on screen rather
    // than swapping in a reworded one mid-read.
    liveQuestion = existing;
  }

  if (liveQuestion === existing && existing) {
    // Keep whatever question is in the row at write time, not the copy
    // read above — the instant path may have streamed more of its answer
    // (or finished it) in between.
    const { liveQuestion: _ignored, ...rest } = coaching;
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
    .set({ liveSuggestions: { ...coaching, liveQuestion } })
    .where(eq(meetings.id, id));
}
