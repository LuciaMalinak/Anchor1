import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, deals, dealMembers, users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { authenticateBearer } from "@/lib/apiToken";

// "This call didn't match any deal — create one for it" — the desktop
// overlay's answer for a meeting that finished with no dealId (see
// FocusWindow.tsx's NoDealPrompt, shown when a call ends unassigned:
// /api/desktop/deals/match-now.ts already tried and came up empty).
// Session OR bearer auth (same dual check as /api/meetings/[id]/live) —
// this needs to work from a real browser AND the desktop overlay's
// BrowserWindow, which has no session cookie of its own, only the
// injected Authorization header (see focus/[meetingId]/page.tsx).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const bearerUserId = session?.user?.id ? null : await authenticateBearer(req);
  const userId = session?.user?.id ?? bearerUserId;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, id), eq(meetings.userId, userId)));
  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Give the deal a name" }, { status: 400 });
  }

  const teamId = await getOrCreateTeamId(userId);
  const [deal] = await db
    .insert(deals)
    .values({ teamId, name, createdByUserId: userId })
    .returning();

  // Same as POST /api/deals — a restricted user still needs membership
  // on a deal they just created themselves, or they'd 404 opening it.
  const [creator] = await db.select().from(users).where(eq(users.id, userId));
  if (creator?.restrictedToDeals) {
    await db.insert(dealMembers).values({ dealId: deal.id, userId });
  }

  // Guard with isNull(dealId) rather than just the id — if something
  // else assigned this meeting a deal in the few seconds since the
  // overlay decided to show this prompt (unlikely, but this is exactly
  // the kind of race that's cheap to close off), don't silently
  // overwrite it. The new deal still exists either way — just came back
  // unattached, and the meeting keeps whatever it already had.
  const updated = await db
    .update(meetings)
    .set({ dealId: deal.id })
    .where(and(eq(meetings.id, id), isNull(meetings.dealId)))
    .returning({ id: meetings.id });

  return NextResponse.json({
    deal: { id: deal.id, name: deal.name },
    attached: updated.length > 0,
  });
}
