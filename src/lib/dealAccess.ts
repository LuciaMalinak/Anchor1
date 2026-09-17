import { db } from "@/db";
import { deals, users, dealMembers } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

// Almost every user can see every deal on their team — that's been true
// since deals were added, and stays true for anyone invited the normal
// way (src/app/api/team/route.ts). The one exception is someone who
// joined through a request-to-join link that named a specific deal (see
// /join/[teamId] and /api/join-requests/[id]/approve): they're flagged
// `restrictedToDeals` and only see deals they have a `dealMembers` row
// for. Every deal-scoped page and API route should go through one of the
// two helpers below rather than checking `deals.teamId` on its own, so
// that restriction is enforced consistently everywhere.

export type DealAuthorization = {
  deal: typeof deals.$inferSelect;
  teamId: string;
  restrictedToDeals: boolean;
};

// For a single deal (a deal detail page, or any /api/deals/[id]/** route)
// — returns null if the deal doesn't exist, belongs to a different team,
// or this user is restricted and hasn't been granted this specific deal.
export async function authorizeDeal(
  userId: string,
  dealId: string
): Promise<DealAuthorization | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.teamId) return null;

  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal || deal.teamId !== user.teamId) return null;

  if (user.restrictedToDeals) {
    const [membership] = await db
      .select()
      .from(dealMembers)
      .where(and(eq(dealMembers.dealId, dealId), eq(dealMembers.userId, userId)));
    if (!membership) return null;
  }

  return { deal, teamId: user.teamId, restrictedToDeals: user.restrictedToDeals };
}

// Cheaper yes/no version for spots that already have the deal loaded
// (e.g. a meeting's dealId) and just need to know if this user can see
// it — same rule as authorizeDeal, without a second deals lookup.
export async function canAccessDeal(userId: string, dealId: string, dealTeamId: string): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.teamId || user.teamId !== dealTeamId) return false;
  if (!user.restrictedToDeals) return true;

  const [membership] = await db
    .select()
    .from(dealMembers)
    .where(and(eq(dealMembers.dealId, dealId), eq(dealMembers.userId, userId)));
  return Boolean(membership);
}

// For a list view (the Deals page, insights, etc.) — `"all"` is the
// common case (unrestricted user, sees every deal on the team) so
// callers can skip building an IN() clause entirely; a restricted user
// gets back the specific ids they're allowed to see (possibly empty).
export async function accessibleDealIds(
  userId: string
): Promise<{ teamId: string; dealIds: string[] | "all" } | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.teamId) return null;

  if (!user.restrictedToDeals) {
    return { teamId: user.teamId, dealIds: "all" };
  }

  const rows = await db
    .select({ dealId: dealMembers.dealId })
    .from(dealMembers)
    .where(eq(dealMembers.userId, userId));
  return { teamId: user.teamId, dealIds: rows.map((r) => r.dealId) };
}

// Drizzle `where` fragment for a deals-table query, given the result of
// accessibleDealIds — a small helper since the "all vs. specific ids"
// branch shows up at every deal list query.
export function dealVisibilityWhere(access: { teamId: string; dealIds: string[] | "all" }) {
  if (access.dealIds === "all") {
    return eq(deals.teamId, access.teamId);
  }
  // An empty array would make inArray() match nothing anyway, but be
  // explicit — a restricted user with zero granted deals sees an empty
  // list, not an error.
  if (access.dealIds.length === 0) {
    return and(eq(deals.teamId, access.teamId), inArray(deals.id, ["__none__"]));
  }
  return and(eq(deals.teamId, access.teamId), inArray(deals.id, access.dealIds));
}
