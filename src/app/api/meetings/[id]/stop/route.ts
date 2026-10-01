import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, deals } from "@/db/schema";
import { and, eq, or } from "drizzle-orm";
import { processMeeting } from "@/lib/processMeeting";
import { canAccessDeal } from "@/lib/dealAccess";
import { leaveCall, cancelBot } from "@/lib/recall";

// Lets someone end a live meeting early — a "Send Anchor to a live
// meeting" bot, or an in-person recording (see the !recallBotId branch).
// Originally only for bots — see
// src/components/StopMeetingButton.tsx for where this gets called from
// (the During tab's live panel, the Focus window). This does NOT end the
// call for anyone else on it, only tells Recall.ai's bot to leave.
//
// Two paths:
// - Normal case: Recall's leave_call succeeds, meaning the bot really was
//   in the call. We leave the meeting's status alone here — the existing
//   recording.done webhook (src/app/api/webhooks/recall/route.ts) picks
//   it up from there exactly like it does when a call ends naturally, and
//   the live poll (useLiveMeeting) picks up that change once Recall
//   reports it.
// - Stuck case: the bot never actually made it into the call yet, so
//   Recall's leave_call can't touch it (its error code is
//   cannot_command_unstarted_bot) — this used to mean clicking Stop just
//   repeated the same error forever with no way out. There's nothing to
//   lose (no recording exists yet), so this now ends the meeting in
//   Anchor right away instead of making the user keep retrying.
// - `force: true` in the body: an explicit "end it anyway" for any other
//   error this route hits talking to Recall — always ends the meeting in
//   Anchor locally, best-effort telling Recall too. If Recall's bot was
//   in fact still recording, its recording.done webhook still arrives
//   later and moves the meeting on to transcription normally — this
//   local "failed" is only about Anchor's own UI no longer treating it
//   as live, not a claim that nothing was recorded.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const isOwner = meeting.userId === session.user.id;
  let deal: typeof deals.$inferSelect | null = null;
  if (meeting.dealId) {
    const [d] = await db.select().from(deals).where(eq(deals.id, meeting.dealId));
    deal = d ?? null;
  }
  const sharedViaTeam =
    !isOwner && deal ? await canAccessDeal(session.user.id, deal.id, deal.teamId, deal) : false;
  if (!isOwner && !sharedViaTeam) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  if (meeting.status !== "joining" && meeting.status !== "recording") {
    return NextResponse.json({ error: "This meeting isn't live." }, { status: 400 });
  }
  if (!meeting.recallBotId) {
    if (meeting.recallRecordingId) {
      return NextResponse.json(
        { error: "Anchor Desktop is recording this call — stop it from the desktop app." },
        { status: 400 }
      );
    }
    // An in-person recording. When the browser tab holding its audio is
    // the one asking, the client stops that recorder and uploads the
    // audio instead of calling this (see src/lib/stopMeeting.ts). Getting
    // here means the audio isn't reachable — the tab was reloaded, closed,
    // or it's a different page — so wrap the meeting up from its live
    // transcript (processMeeting falls back to it when there's no audio)
    // rather than leaving it stuck "live" with no way to stop it. The
    // status guard keeps this from racing a real upload that just landed.
    const [ended] = await db
      .update(meetings)
      .set({ status: "uploaded", updatedAt: new Date() })
      .where(and(eq(meetings.id, id), or(eq(meetings.status, "recording"), eq(meetings.status, "joining"))))
      .returning({ id: meetings.id });
    if (ended) {
      // Fire and forget — same pattern as finish-recording; the live poll
      // picks up the status change.
      void processMeeting(id);
    }
    return NextResponse.json({ ok: true, fromLiveTranscript: true });
  }

  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;

  async function endLocally(errorMessage: string) {
    await db
      .update(meetings)
      .set({ status: "failed", errorMessage, updatedAt: new Date() })
      .where(eq(meetings.id, id));
    return NextResponse.json({ ok: true, forced: true });
  }

  if (force) {
    // The explicit escape hatch — whatever Recall says, don't leave the
    // user stuck. Best-effort on Recall's side only.
    if (meeting.recallBotId) {
      await leaveCall(meeting.recallBotId).catch(() => {});
      await cancelBot(meeting.recallBotId).catch(() => {});
    }
    return endLocally(
      "Ended manually in Anchor. If Anchor's bot was still connecting, it may take a minute to leave the call on its own."
    );
  }

  try {
    await leaveCall(meeting.recallBotId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't end the meeting";
    if (message.includes("still joining")) {
      // Nothing's been recorded yet if the bot never made it in — safe
      // to just end this rather than making the user retry Stop until
      // the join eventually resolves on its own.
      await cancelBot(meeting.recallBotId).catch(() => {});
      return endLocally("Anchor's bot never made it into the call, so this meeting was ended.");
    }
    console.error(`[meetings/stop] Failed to end bot for meeting ${id}:`, err);
    return NextResponse.json({ error: message, canForceEnd: true }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
