import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, summaries, deals, users, meetingParticipants, contacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { draftFollowUpEmail } from "@/lib/summarize";
import { canAccessDeal } from "@/lib/dealAccess";

// Generates a draft, client-facing follow-up email for a finished
// meeting. Not persisted — cheap enough to regenerate, and this way
// there's no stale-copy problem if the meeting's summary ever changes.
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
  // A meeting's dealId isn't guaranteed to be one this user — even the
  // owner — actually has access to (see the root-cause note in
  // meetings/route.ts; older meetings created before that fix could
  // still carry a foreign dealId). Previously this check only ran for
  // a non-owner, so the owner's own meeting could pull ANOTHER team's
  // deal data below via meeting.dealId with no check at all.
  const canUseDeal = Boolean(
    deal && (await canAccessDeal(session.user.id, meeting.dealId as string, deal.teamId))
  );
  if (!isOwner && !canUseDeal) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  if (meeting.status !== "ready") {
    return NextResponse.json({ error: "This meeting hasn't finished processing yet" }, { status: 400 });
  }

  const [summary] = await db.select().from(summaries).where(eq(summaries.meetingId, id));
  if (!summary) {
    return NextResponse.json({ error: "No summary available for this meeting" }, { status: 400 });
  }

  const [sender] = await db.select().from(users).where(eq(users.id, session.user.id));
  const participants = await db
    .select({ displayName: meetingParticipants.displayName, email: contacts.email })
    .from(meetingParticipants)
    .leftJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
    .where(eq(meetingParticipants.meetingId, id));

  let recipientEmails = participants.map((p) => p.email).filter((e): e is string => Boolean(e));
  if (recipientEmails.length === 0 && canUseDeal && deal?.primaryContactEmail) {
    recipientEmails = [deal.primaryContactEmail];
  }

  try {
    const draft = await draftFollowUpEmail({
      meetingTitle: meeting.title,
      overview: summary.overview,
      keyPoints: summary.keyPoints,
      actionItems: summary.actionItems,
      senderName: sender?.name || sender?.email || "there",
      recipientNames: participants.map((p) => p.displayName).filter((n): n is string => Boolean(n)),
    });
    return NextResponse.json({ draft, recipientEmails });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't draft the email" },
      { status: 502 }
    );
  }
}
