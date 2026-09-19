import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, meetingParticipants, deals } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { canAccessDeal } from "@/lib/dealAccess";

// Lets anyone who can see this meeting (the person who recorded it, or a
// teammate who can see the deal it's attached to — same rule the meeting
// page itself uses) fix a speaker's name by hand. AssemblyAI only tells
// us "Speaker A" / "Speaker B" — it doesn't know who that is; the AI
// summary step (see summarize.ts) tries to infer a real name from what's
// actually said in the conversation (an introduction, someone being
// addressed by name), but plenty of real recordings never say anyone's
// name out loud, or the model guesses wrong. This is the manual fallback
// for either case, editable straight from the transcript view.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; participantId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id: meetingId, participantId } = await params;

  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = meeting.userId === session.user.id;
  let canEdit = isOwner;
  if (!canEdit && meeting.dealId) {
    const [deal] = await db.select().from(deals).where(eq(deals.id, meeting.dealId));
    canEdit = Boolean(deal && (await canAccessDeal(session.user.id, meeting.dealId, deal.teamId)));
  }
  if (!canEdit) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [participant] = await db
    .select()
    .from(meetingParticipants)
    .where(and(eq(meetingParticipants.id, participantId), eq(meetingParticipants.meetingId, meetingId)));
  if (!participant) {
    return NextResponse.json({ error: "That speaker doesn't exist on this meeting" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const raw = typeof body.displayName === "string" ? body.displayName.trim() : "";
  // Empty input clears back to the raw "Speaker A" label rather than
  // saving a blank name — there's no reason to persist "".
  const displayName = raw.length > 0 ? raw : null;

  await db
    .update(meetingParticipants)
    .set({ displayName })
    .where(eq(meetingParticipants.id, participantId));

  return NextResponse.json({ ok: true, displayName });
}
