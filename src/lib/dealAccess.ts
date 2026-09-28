import { db } from "@/db";
import { deals, users, dealMembers } from "@/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";

// Almost every user can see every deal on their team — that's been true
// since deals were added, and stays true for anyone invited the normal
// way (src/app/api/team/route.ts). Two things narrow that, and either
// can apply independently:
//
// - users.restrictedToDeals: a per-PERSON lock. Set only for someone who
//   joined through a request-to-join link that named a specific deal
//   (see /join/[teamId] and /api/join-requests/[id]/approve) — they only
//   ever see deals they have a `dealMembers` row for, no matter which
//   deal.
// - deals.restricted: a per-DEAL lock, set from the deal page by anyone
//   who can currently see it ("only certain people at my company should
//   see this client"). When true, only the deal's creator/lead/backup
//   and whoever has a `dealMembers` row for THIS deal can see it — even
//   a teammate who isn't personally restrictedToDeals.
//
// Every deal-scoped page and API route should go through one of the
// helpers below rather than checking `deals.teamId` on its own, so both
// restrictions are enforced consistently everywhere.

export type DealAuthorization = {
  deal: typeof deals.$inferSelect;
  teamId: string;
  restrictedToDeals: boolean;
};

// A user always implicitly has access to a restricted deal they created,
// lead, or back up — without this, restricting a deal to "just a few
// people" could lock out the very person who set that up, or the lead
// who was assigned before ever being added to dealMembers by hand.
function isImplicitDealMember(deal: { createdByUserId: string; leadUserId: string | null; backupUserId: string | null }, userId: string): boolean {
  return deal.createdByUserId === userId || deal.leadUserId === userId || deal.backupUserId === userId;
}

async function hasDealMembership(dealId: string, userId: string): Promise<boolean> {
  const [membership] = await db
    .select()
    .from(dealMembers)
    .where(and(eq(dealMembers.dealId, dealId), eq(dealMembers.userId, userId)));
  return Boolean(membership);
}

// For a single deal (a deal detail page, or any /api/deals/[id]/** route)
// — returns null if the deal doesn't exist, belongs to a different team,
// or this user isn't allowed to see it under either restriction above.
export async function authorizeDeal(
  userId: string,
  dealId: string
): Promise<DealAuthorization | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.teamId) return null;

  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal || deal.teamId !== user.teamId) return null;

  if (user.restrictedToDeals || deal.restricted) {
    if (!isImplicitDealMember(deal, userId) && !(await hasDealMembership(dealId, userId))) {
      return null;
    }
  }

  return { deal, teamId: user.teamId, restrictedToDeals: user.restrictedToDeals };
}

// Cheaper yes/no version for spots that already have the deal loaded
// (e.g. a meeting's dealId) and just need to know if this user can see
// it — same rule as authorizeDeal, without a second deals lookup. Takes
// the deal's restriction/ownership fields directly rather than a full
// deal row, since most callers only have a partial one on hand.
export async function canAccessDeal(
  userId: string,
  dealId: string,
  dealTeamId: string,
  dealRestriction?: { restricted: boolean; createdByUserId: string; leadUserId: string | null; backupUserId: string | null }
): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.teamId || user.teamId !== dealTeamId) return false;

  // Callers that only ever had the old (dealId, dealTeamId) signature —
  // there are several — can't tell us the deal's restriction fields, so
  // fall back to loading them. Passing dealRestriction when it's already
  // on hand (see follow-up-draft/route.ts, live/route.ts) just saves a
  // query.
  const restriction =
    dealRestriction ??
    (await db.select().from(deals).where(eq(deals.id, dealId))).at(0);
  if (!restriction) return false;

  if (!user.restrictedToDeals && !restriction.restricted) return true;
  return isImplicitDealMember(restriction, userId) || hasDealMembership(dealId, userId);
}

// For a list view (the Deals page, insights, etc.) — `dealIds: "all"` is
// the common case (an unrestricted user with no individually-restricted
// deals) so callers can skip building an IN() clause entirely.
// `memberDealIds` is always returned alongside it: the ids of deals
// (restricted or not) this user has an explicit dealMembers grant on —
// dealVisibilityWhere needs it to include an individually-restricted
// deal this otherwise-unrestricted user was specifically added to.
export async function accessibleDealIds(
  userId: string
): Promise<{ teamId: string; dealIds: string[] | "all"; memberDealIds: string[] } | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.teamId) return null;

  const memberRows = await db
    .select({ dealId: dealMembers.dealId })
    .from(dealMembers)
    .where(eq(dealMembers.userId, userId));
  const memberDealIds = memberRows.map((r) => r.dealId);

  if (user.restrictedToDeals) {
    return { teamId: user.teamId, dealIds: memberDealIds, memberDealIds };
  }
  return { teamId: user.teamId, dealIds: "all", memberDealIds };
}

// Drizzle `where` fragment for a deals-table query, given the result of
// accessibleDealIds — a small helper since the "all vs. specific ids"
// branch shows up at every deal list query.
export function dealVisibilityWhere(access: { teamId: string; dealIds: string[] | "all"; memberDealIds: string[] }) {
  if (access.dealIds !== "all") {
    // A globally restrictedToDeals user — sees only deals they have an
    // explicit grant for, same as always. An empty array would make
    // inArray() match nothing anyway, but be explicit about it.
    if (access.dealIds.length === 0) {
      return and(eq(deals.teamId, access.teamId), inArray(deals.id, ["__none__"]));
    }
    return and(eq(deals.teamId, access.teamId), inArray(deals.id, access.dealIds));
  }
  // An unrestricted user — sees every non-restricted deal on the team,
  // plus any individually-restricted deal they've been explicitly added
  // to (memberDealIds). Doesn't need to also check creator/lead/backup
  // here the way the single-deal helpers do: whoever creates or leads a
  // restricted deal is added to dealMembers for it at that point (see
  // the deals PATCH route), so they always show up in memberDealIds too.
  if (access.memberDealIds.length === 0) {
    return and(eq(deals.teamId, access.teamId), eq(deals.restricted, false));
  }
  return and(
    eq(deals.teamId, access.teamId),
    or(eq(deals.restricted, false), inArray(deals.id, access.memberDealIds))
  );
}
