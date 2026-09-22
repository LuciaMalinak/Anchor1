import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, meetingLiveSegments, deals, summaries, dealFiles } from "@/db/schema";
import { and, desc, eq, ne, asc } from "drizzle-orm";
import { generateLiveCoaching } from "@/lib/liveCoaching";
import { canAccessDeal } from "@/lib/dealAccess";
import { getDealLeadStyle } from "@/lib/styleProfile";
import { summarizeDealFiles } from "@/lib/dealFilesContext";
import { authenticateBearer } from "@/lib/apiToken";

// How often live coaching (nudges + checklist) is allowed to regenerate.
// The During tab polls this route every couple of seconds (see
// LiveMeetingPanel.tsx) for a smooth-feeling live transcript, but
// re-running the AI call that often would be slow and needlessly
// expensive — this debounces it server-side so it doesn't matter how
// often (or how many open tabs) poll this route. Was 20s; tightened to
// keep nudges feeling like they're keeping up with the conversation
// rather than lagging noticeably behind it — still bounded, still one
// call at a time no matter how many people have the tab open (the soft
// lock below), just a shorter window.
const COACHING_REFRESH_MS = 8_000;
// How much of the transcript (from the end) to hand the model each time,
// in characters — enough context without an ever-growing prompt as a
// long call goes on.
const TRANSCRIPT_WINDOW_CHARS = 6_000;
// How many of this deal's past FINISHED meetings to ground nudges in —
// same idea as assist/route.ts's recentReady, just smaller since this
// regenerates far more often (every ~8s) during a live call.
const PAST_MEETINGS_LIMIT = 3;

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

  const segments = await db
    .select()
    .from(meetingLiveSegments)
    .where(eq(meetingLiveSegments.meetingId, id))
    .orderBy(asc(meetingLiveSegments.createdAt));

  let liveSuggestions = meeting.liveSuggestions;

  const isLive = meeting.status === "joining" || meeting.status === "recording";
  const transcriptText = segments
    .map((s) => (s.speakerName ? `${s.speakerName}: ${s.text}` : s.text))
    .join("\n");
  // No longer gated on the transcript having anything in it yet — nudges
  // used to stay blank ("Nudges show up here once the conversation gets
  // going") until the first words were transcribed, which could be a
  // real gap right at the start of a call when there's nothing urgent to
  // react to live but plenty already known about the deal (prep notes,
  // decision boundaries, what happened last meeting). Coaching now keeps
  // regenerating on the same debounced cadence the whole time the
  // meeting is live, transcript or not — see generateLiveCoaching's
  // instruction to always ground nudges in known facts when the live
  // conversation hasn't given it anything new yet, rather than going
  // quiet.
  const dueForRefresh =
    isLive &&
    (!meeting.liveSuggestionsUpdatedAt ||
      Date.now() - meeting.liveSuggestionsUpdatedAt.getTime() > COACHING_REFRESH_MS);

  if (dueForRefresh) {
    // Soft lock: stamp the timestamp before the (slow) AI call so a
    // second poll landing a moment later doesn't kick off a duplicate
    // generation for the same window.
    await db
      .update(meetings)
      .set({ liveSuggestionsUpdatedAt: new Date() })
      .where(eq(meetings.id, id));

    try {
      // Never rebuilt synchronously here — this route is polled every
      // few seconds during a live call, so it reads whatever style
      // profile already exists (possibly a day stale) rather than ever
      // waiting on a rebuild.
      const [leadStyle, pastMeetingRows, fileRows] = await Promise.all([
        getDealLeadStyle(deal?.leadUserId ?? null, { allowSynchronousRebuild: false }),
        deal
          ? db
              .select({ meeting: meetings, summary: summaries })
              .from(meetings)
              .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
              .where(
                and(
                  eq(meetings.dealId, deal.id),
                  eq(meetings.status, "ready"),
                  ne(meetings.id, id)
                )
              )
              .orderBy(desc(meetings.occurredAt))
              .limit(PAST_MEETINGS_LIMIT)
          : Promise.resolve([]),
        // Files/voice notes attached from the Before tab's "Give Anchor
        // more context" box (see DealContextBox.tsx) — a bounded digest,
        // not the full text (see dealFilesContext.ts for why).
        deal
          ? db.select().from(dealFiles).where(eq(dealFiles.dealId, deal.id))
          : Promise.resolve([]),
      ]);
      const coaching = await generateLiveCoaching({
        dealName: deal?.name || null,
        dealMemory: deal?.memory || null,
        decisionBoundaries: deal?.decisionBoundaries || null,
        recentTranscript: transcriptText.slice(-TRANSCRIPT_WINDOW_CHARS),
        priorChecklist: meeting.liveSuggestions?.checklist || null,
        leadStyle,
        notes: deal?.notes || null,
        // Already cached on the deal row (refreshed at most every 6h — see
        // src/lib/dealIntegrationContext.ts), so this adds zero extra
        // latency to a live poll. Ask Anchor and handoff briefings already
        // had this; live coaching was blind to Gmail/Calendar until now.
        emailContext: deal?.emailContext || null,
        calendarContext: deal?.calendarContext || null,
        attachedFiles: summarizeDealFiles(fileRows),
        pastMeetings: pastMeetingRows.map((r) => ({
          title: r.meeting.title,
          occurredAt: r.meeting.occurredAt.toLocaleDateString(),
          overview: r.summary.overview,
          dealSignals: r.summary.dealSignals,
        })),
      });
      await db
        .update(meetings)
        .set({ liveSuggestions: coaching, liveSuggestionsUpdatedAt: new Date() })
        .where(eq(meetings.id, id));
      liveSuggestions = coaching;
    } catch (err) {
      // Live coaching is a nice-to-have layered on top of the live
      // transcript, which still works fine on its own — never fail the
      // whole poll (and the transcript feed with it) just because a
      // coaching refresh hiccuped.
      console.error(`[live coaching] failed for meeting ${id}:`, err);
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
    segments: segments.map((s) => ({
      id: s.id,
      speakerName: s.speakerName,
      text: s.text,
      relativeSeconds: s.relativeSeconds,
    })),
    liveSuggestions,
  });
}
