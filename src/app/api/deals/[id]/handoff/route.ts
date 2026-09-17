import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, summaries, meetingParticipants, contacts } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { generateHandoffBriefing } from "@/lib/handoffBriefing";
import { authorizeDeal } from "@/lib/dealAccess";

// Generates a point-in-time briefing for a teammate stepping in to run
// this deal's next meeting — not persisted, since it should always
// reflect the latest state when generated rather than go stale.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const authorized = await authorizeDeal(session.user.id, dealId);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const { deal } = authorized;

  const recentReady = await db
    .select({ meeting: meetings, summary: summaries })
    .from(meetings)
    .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
    .where(and(eq(meetings.dealId, dealId), eq(meetings.status, "ready")))
    .orderBy(desc(meetings.occurredAt))
    .limit(5);

  // The people Anchor has resolved on this deal, with whatever it's
  // learned (or been told directly) about each — the source for the
  // briefing's "personal touches" section, so it's grounded in real notes
  // rather than invented rapport.
  const dealContactRows = await db
    .selectDistinctOn([contacts.id], {
      name: contacts.name,
      role: contacts.role,
      relationshipSummary: contacts.relationshipSummary,
      notes: contacts.notes,
    })
    .from(meetingParticipants)
    .innerJoin(meetings, eq(meetingParticipants.meetingId, meetings.id))
    .innerJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
    .where(eq(meetings.dealId, dealId));

  try {
    const briefing = await generateHandoffBriefing({
      dealName: deal.name,
      memory: deal.memory,
      notes: deal.notes,
      people: dealContactRows,
      recentMeetings: recentReady.map((r) => ({
        title: r.meeting.title,
        occurredAt: r.meeting.occurredAt.toLocaleDateString(),
        overview: r.summary.overview,
        keyPoints: r.summary.keyPoints,
        actionItems: r.summary.actionItems,
      })),
    });
    return NextResponse.json({ briefing });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't generate a handoff briefing right now." },
      { status: 502 }
    );
  }
}
