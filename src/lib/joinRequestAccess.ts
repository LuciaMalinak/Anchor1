// Who can see and act on requests to join a team — see the `join_request`
// table and /api/join-requests/[id]/approve|decline, the only callers of
// the two functions below. Three kinds of person qualify: the app owner
// (Lucia, across every team — see src/lib/appOwner.ts), the team owner
// (whoever created the team), and a deal lead (only for their own
// deal(s), and only once a specific deal has been picked).
import { db } from "@/db";
import { teams, deals } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { isAppOwner } from "@/lib/appOwner";

async function isTeamOwner(userId: string, teamId: string): Promise<boolean> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  return Boolean(team?.ownerUserId && team.ownerUserId === userId);
}

async function leadsAnyDealOnTeam(userId: string, teamId: string): Promise<boolean> {
  const [lead] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.teamId, teamId), eq(deals.leadUserId, userId)));
  return Boolean(lead);
}

async function isDealLead(userId: string, dealId: string): Promise<boolean> {
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  return Boolean(deal?.leadUserId && deal.leadUserId === userId);
}

// Gates whether this person can see/decline a team's pending requests at
// all (used for the Team page's per-team section, and for decline, which
// doesn't involve picking a specific deal).
export async function canManageJoinRequests(
  userId: string,
  email: string | null | undefined,
  teamId: string
): Promise<boolean> {
  if (isAppOwner(email)) return true;
  if (await isTeamOwner(userId, teamId)) return true;
  return leadsAnyDealOnTeam(userId, teamId);
}

// The stricter check made at approval time, once a specific deal has
// been chosen: the team owner and the app owner can grant access to any
// deal, but a deal lead can only approve into deal(s) they actually
// lead.
export async function canApproveForDeal(
  userId: string,
  email: string | null | undefined,
  teamId: string,
  dealId: string
): Promise<boolean> {
  if (isAppOwner(email)) return true;
  if (await isTeamOwner(userId, teamId)) return true;
  return isDealLead(userId, dealId);
}
