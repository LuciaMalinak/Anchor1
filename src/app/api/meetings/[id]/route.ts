import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, transcripts, summaries, meetingParticipants, contacts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { deleteMeetingAudio } from "@/lib/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, id), eq(meetings.userId, session.user.id)));

  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.meetingId, id));

  const [summary] = await db
    .select()
    .from(summaries)
    .where(eq(summaries.meetingId, id));

  const participants = await db
    .select({
      id: meetingParticipants.id,
      speakerLabel: meetingParticipants.speakerLabel,
      displayName: meetingParticipants.displayName,
      contactId: meetingParticipants.contactId,
      relationshipSummary: contacts.relationshipSummary,
      meetingCount: contacts.meetingCount,
    })
    .from(meetingParticipants)
    .leftJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
    .where(eq(meetingParticipants.meetingId, id));

  return NextResponse.json({ meeting, transcript, summary, participants });
}

// Owner-only — a meeting shared with the rest of the team via a deal can
// still be viewed by teammates (see the page's isOwner/sharedViaTeam
// check), but only the person who recorded/uploaded it can delete it.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, id), eq(meetings.userId, session.user.id)));
  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The transcript, summary, and meeting_participant rows cascade-delete
  // at the database level (see schema.ts) — deleting the meeting row
  // handles the data. The audio file on disk is cleaned up separately.
  await db.delete(meetings).where(eq(meetings.id, id));
  await deleteMeetingAudio(id);

  return NextResponse.json({ ok: true });
}
