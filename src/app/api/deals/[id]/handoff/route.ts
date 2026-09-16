import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, meetings, summaries, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { generateHandoffBriefing } from "@/lib/handoffBriefing";

async function authorizeDeal(userId: string, dealId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal || !user?.teamId || deal.teamId !== user.teamId) return null;
  return deal;
}

// Generates a point-in-time briefing for a teammate stepping in to run
// this deal's next meeting — not persisted, since it should always
// reflect the latest state when generated rather than go stale.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const deal = await authorizeDeal(session.user.id, dealId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const recentReady = await db
    .select({ meeting: meetings, summary: summaries })
    .from(meetings)
    .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
    .where(and(eq(meetings.dealId, dealId), eq(meetings.status, "ready")))
    .orderBy(desc(meetings.occurredAt))
    .limit(5);

  try {
    const briefing = await generateHandoffBriefing({
      dealName: deal.name,
      memory: deal.memory,
      notes: deal.notes,
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
