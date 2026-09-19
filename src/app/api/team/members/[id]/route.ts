import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, teams, deals } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";

// Owner-only — removes a teammate from the team (not their account).
// This is a soft removal: it clears their teamId so they immediately
// lose access to every deal on this team (see authorizeDeal/canAccessDeal
// — both key off matching teamId), but leaves everything they created
// (meetings, deal notes, chat messages) in place for the rest of the
// team. They aren't signed out mid-session, but the next page they load
// re-checks team membership and getOrCreateTeamId gives them a fresh,
// empty team of their own — same as any brand-new account.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: memberId } = await params;

  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team || team.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "Only the team owner can remove people" }, { status: 403 });
  }

  if (memberId === session.user.id) {
    return NextResponse.json({ error: "You can't remove yourself from the team" }, { status: 400 });
  }

  const [member] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, memberId), eq(users.teamId, teamId)));
  if (!member) {
    return NextResponse.json({ error: "That person isn't on your team" }, { status: 404 });
  }

  await db.update(users).set({ teamId: null }).where(eq(users.id, memberId));

  // Clear any deal-lead/backup assignments pointing at them on this
  // team's deals — otherwise a removed person could keep showing up as
  // "Deal lead" even though they no longer have access to see the deal.
  await db.update(deals).set({ leadUserId: null }).where(and(eq(deals.teamId, teamId), eq(deals.leadUserId, memberId)));
  await db.update(deals).set({ backupUserId: null }).where(and(eq(deals.teamId, teamId), eq(deals.backupUserId, memberId)));

  return NextResponse.json({ ok: true });
}
