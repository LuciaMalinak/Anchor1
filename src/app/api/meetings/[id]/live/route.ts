import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, meetingLiveSegments, deals, users } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { generateLiveCoaching } from "@/lib/liveCoaching";

// How often live coaching (nudges + checklist) is allowed to regenerate.
// The During tab polls this route every few seconds for a smooth-feeling
// live transcript, but re-running the AI call that often would be slow
// and needlessly expensive — this debounces it server-side so it doesn't
// matter how often (or how many open tabs) poll this route.
const COACHING_REFRESH_MS = 20_000;
// How much of the transcript (from the end) to hand the model each time,
// in characters — enough context without an ever-growing prompt as a
// long call goes on.
const TRANSCRIPT_WINDOW_CHARS = 6_000;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const dealRows = meeting.dealId
    ? await db.select().from(deals).where(eq(deals.id, meeting.dealId))
    : [];
  const deal = dealRows[0] ?? null;

  let sharedViaTeam = false;
  if (!isOwner && deal) {
    const [viewer] = await db.select().from(users).where(eq(users.id, session.user.id));
    sharedViaTeam = Boolean(viewer?.teamId && deal.teamId === viewer.teamId);
  }
  if (!isOwner && !sharedViaTeam) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
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
  const dueForRefresh =
    isLive &&
    transcriptText.length > 0 &&
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
      const coaching = await generateLiveCoaching({
        dealName: deal?.name || null,
        dealMemory: deal?.memory || null,
        decisionBoundaries: deal?.decisionBoundaries || null,
        recentTranscript: transcriptText.slice(-TRANSCRIPT_WINDOW_CHARS),
        priorChecklist: meeting.liveSuggestions?.checklist || null,
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
    segments: segments.map((s) => ({
      id: s.id,
      speakerName: s.speakerName,
      text: s.text,
      relativeSeconds: s.relativeSeconds,
    })),
    liveSuggestions,
  });
}
