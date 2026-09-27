import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, transcripts, summaries, meetingParticipants, contacts, deals } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { deleteMeetingAudio } from "@/lib/storage";
import { canAccessDeal, authorizeDeal } from "@/lib/dealAccess";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;

  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Same visibility rule as everywhere else a meeting can be seen (the
  // deal page's During/After tabs, the Stop button, the Focus window
  // context) — owner, or anyone who can see the deal it's attached to.
  // This used to be owner-only, which meant a teammate watching someone
  // else's live meeting on a shared deal never actually saw it end here
  // (this is what the deal page's live-status poller calls) — it just
  // 404'd for them every time and looked permanently stuck.
  const isOwner = meeting.userId === session.user.id;
  let sharedViaTeam = false;
  if (!isOwner && meeting.dealId) {
    const [deal] = await db.select().from(deals).where(eq(deals.id, meeting.dealId));
    sharedViaTeam = Boolean(
      deal && (await canAccessDeal(session.user.id, meeting.dealId, deal.teamId, deal))
    );
  }
  if (!isOwner && !sharedViaTeam) {
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

// Owner-only — lets whoever recorded a meeting fix its deal assignment
// after the fact: the desktop app's auto-match (see
// src/app/api/desktop/deals/match-now/route.ts) is a best-effort guess
// off the calendar, and a bot-joined call can land unassigned too if no
// deal's known contacts matched the invite. Without this, a wrong or
// missing guess had no fix except asking an engineer — not something
// anyone wants to discover live in front of an investor.
export async function PATCH(
  req: NextRequest,
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

  const body = await req.json().catch(() => ({}));
  if (!("dealId" in body)) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  const dealId = body.dealId as string | null;

  // null is always allowed (unassign). A real id has to actually be a
  // deal this user can access — otherwise this would double as a way to
  // attach someone else's meeting recording to a deal they can't
  // otherwise see, leaking its transcript/summary to anyone who can see
  // that deal.
  if (dealId !== null) {
    const authorized = await authorizeDeal(session.user.id, dealId);
    if (!authorized) {
      return NextResponse.json({ error: "That deal isn't available" }, { status: 400 });
    }
  }

  await db.update(meetings).set({ dealId }).where(eq(meetings.id, id));
  return NextResponse.json({ ok: true });
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
