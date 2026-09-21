import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

// Lightweight "is anything of mine live right now" check — polled
// globally across the dashboard (see LiveMeetingWatcher.tsx) so a
// scheduled call going live surfaces a prompt to open the Focus window
// no matter which page someone's on, not just if they already happen to
// be sitting on that deal's During tab. Scoped to meetings THIS person's
// account owns (started, uploaded, or joined) — same scope
// getAttentionItems' stuckMeetings query uses (src/lib/attention.ts) —
// not every meeting the whole team can see, since this is about "my own
// scheduled call," not a team-wide feed.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ meetings: [] });
  }

  const rows = await db
    .select({ id: meetings.id, title: meetings.title, dealId: meetings.dealId, status: meetings.status })
    .from(meetings)
    .where(and(eq(meetings.userId, session.user.id), inArray(meetings.status, ["joining", "recording"])));

  return NextResponse.json({ meetings: rows });
}
