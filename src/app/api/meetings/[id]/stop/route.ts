import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, deals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canAccessDeal } from "@/lib/dealAccess";
import { leaveCall } from "@/lib/recall";

// Lets someone end a live "Send Anchor to a live meeting" bot early — see
// src/components/StopMeetingButton.tsx for where this gets called from
// (the During tab's live panel, the Focus window). This does NOT end the
// call for anyone else on it, only tells Recall.ai's bot to leave.
// Anything already recorded up to this point still gets processed
// normally: the existing recording.done webhook (see
// src/app/api/webhooks/recall/route.ts) picks up from there exactly like
// it does when a call ends naturally, so this route doesn't touch the
// meeting's status itself — the live poll (useLiveMeeting) picks up the
// change once Recall reports it.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json(
      { error: "This meeting wasn't joined by Anchor's bot, so there's nothing to stop here." },
      { status: 400 }
    );
  }

  try {
    await leaveCall(meeting.recallBotId);
  } catch (err) {
    console.error(`[meetings/stop] Failed to end bot for meeting ${id}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't end the meeting" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
