import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, deals, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canAccessDeal } from "@/lib/dealAccess";
import { resolveFocusWidgets } from "@/lib/focusWidgets";

// The same data, and the same access rule, as the server-rendered
// /focus/[meetingId] page (see src/app/focus/[meetingId]/page.tsx) — but
// as JSON. The Picture-in-Picture Focus window (src/lib/useFocusWindow.ts)
// can't just navigate to that route the way the ordinary popup does: a
// Document Picture-in-Picture window is built by portaling React content
// into it client-side, not by loading a URL, so it fetches this instead.
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

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
  const initialWidgets = resolveFocusWidgets(user?.focusWidgets ?? null);

  return NextResponse.json({
    meetingTitle: meeting.title,
    dealId: deal?.id ?? null,
    dealName: deal?.name ?? null,
    stage: deal?.stage ?? null,
    primaryContactName: deal?.primaryContactName ?? null,
    primaryContactRole: deal?.primaryContactRole ?? null,
    decisionBoundaries: deal?.decisionBoundaries ?? null,
    initialWidgets,
  });
}
