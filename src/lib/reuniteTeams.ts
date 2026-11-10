import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { dataChangeLog, dealMembers, deals, teams, users } from "@/db/schema";
import { isAppOwner } from "@/lib/appOwner";
import { logDataChange } from "@/lib/dataChangeLog";
import { moveDeal, TRASH_TEAM_NAME } from "@/lib/dataSafety";

// Puts people back on the team their deals are on.
//
// Deals belong to a team, and everyone only sees their own team's deals.
// If someone ends up without their team (taken off the Team page before
// removals were logged, or an account that lost its team some other way),
// Anchor used to hand them a brand-new empty team, and all their deals
// looked gone. They never were: they're still on the old team.
//
// A person is put back when:
// - they're on no team, or alone on a team they own (one Anchor made for
//   them), and
// - another team (not the trash) holds deals they created, or deals they
//   were given access to, and
// - nobody deliberately removed them from that team (a "member_removed"
//   entry in the change log means a team owner chose to, so it's left
//   alone).
// Anything they added on the stand-in team moves with them, so nothing is
// left behind. Every move is written to the change log.

type Plan = { userId: string; email: string; fromTeamId: string | null; toTeamId: string; restricted: boolean };

async function planFor(userId: string): Promise<Plan | null> {
  const [user] = await db
    .select({ id: users.id, email: users.email, teamId: users.teamId })
    .from(users)
    .where(eq(users.id, userId));
  // Not the app owner, and not a deleted account (left as an anonymized
  // row; see src/app/api/profile/delete/route.ts).
  if (!user || isAppOwner(user.email) || user.email.endsWith("@anchor.invalid")) return null;

  const [trash] = await db.select({ id: teams.id }).from(teams).where(eq(teams.name, TRASH_TEAM_NAME)).limit(1);
  const trashId = trash?.id ?? null;

  if (user.teamId) {
    const [team] = await db.select({ ownerUserId: teams.ownerUserId }).from(teams).where(eq(teams.id, user.teamId));
    if (!team || team.ownerUserId !== userId) return null;
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.teamId, user.teamId));
    if (n > 1) return null; // a real team with other people on it
  }

  const notHere = (col: typeof deals.teamId) => [
    ...(user.teamId ? [ne(col, user.teamId)] : []),
    ...(trashId ? [ne(col, trashId)] : []),
  ];

  // Teams holding deals this person created, most deals first.
  const created = await db
    .select({ teamId: deals.teamId, n: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.createdByUserId, userId), ...notHere(deals.teamId)))
    .groupBy(deals.teamId)
    .orderBy(sql`count(*) desc`);
  // Teams holding deals they were given access to.
  const shared = await db
    .select({ teamId: deals.teamId, n: sql<number>`count(*)::int` })
    .from(dealMembers)
    .innerJoin(deals, eq(deals.id, dealMembers.dealId))
    .where(and(eq(dealMembers.userId, userId), ...notHere(deals.teamId)))
    .groupBy(deals.teamId)
    .orderBy(sql`count(*) desc`);

  const candidates = [
    ...created.map((c) => ({ teamId: c.teamId, restricted: false })),
    ...shared.map((c) => ({ teamId: c.teamId, restricted: true })),
  ];
  if (candidates.length === 0) return null;

  const removedFrom = new Set(
    (
      await db
        .select({ teamId: dataChangeLog.teamId })
        .from(dataChangeLog)
        .where(and(eq(dataChangeLog.action, "member_removed"), eq(dataChangeLog.targetId, userId)))
    ).map((r) => r.teamId)
  );
  const existing = new Set(
    (
      await db
        .select({ id: teams.id })
        .from(teams)
        .where(inArray(teams.id, candidates.map((c) => c.teamId)))
    ).map((t) => t.id)
  );

  const pick = candidates.find((c) => existing.has(c.teamId) && !removedFrom.has(c.teamId));
  if (!pick) return null;
  return { userId, email: user.email, fromTeamId: user.teamId, toTeamId: pick.teamId, restricted: pick.restricted };
}

async function apply(plan: Plan, reason: string): Promise<void> {
  await db
    .update(users)
    .set({ teamId: plan.toTeamId, restrictedToDeals: plan.restricted })
    .where(eq(users.id, plan.userId));

  let movedDeals = 0;
  if (plan.fromTeamId) {
    const left = await db.select({ id: deals.id }).from(deals).where(eq(deals.teamId, plan.fromTeamId));
    for (const d of left) {
      await moveDeal(d.id, plan.toTeamId);
      // A restricted member keeps seeing what they made on the stand-in team.
      if (plan.restricted) {
        await db.insert(dealMembers).values({ dealId: d.id, userId: plan.userId }).onConflictDoNothing();
      }
      movedDeals++;
    }
  }

  await logDataChange({
    action: "user_restored",
    teamId: plan.toTeamId,
    targetId: plan.userId,
    details: { email: plan.email, fromTeamId: plan.fromTeamId, restricted: plan.restricted, movedDeals, reason },
  });
  console.log(`[reuniteTeams] put a person back on their team (${reason}); moved ${movedDeals} deal(s) with them`);
}

// For one person, when they have no team (src/lib/team.ts). Returns the
// team they were put back on, or null if there's nothing to go back to.
export async function reuniteUser(userId: string, reason: string): Promise<string | null> {
  const plan = await planFor(userId);
  if (!plan) return null;
  await apply(plan, reason);
  return plan.toTeamId;
}

// At every start (src/instrumentation.ts): checks everyone who is alone on
// a team of their own, or on no team.
export async function reuniteAll(): Promise<number> {
  const solo = await db.execute<{ id: string }>(sql`
    select u.id from "user" u
    left join "team" t on t.id = u."teamId"
    where u."teamId" is null
       or (t."ownerUserId" = u.id
           and (select count(*) from "user" m where m."teamId" = u."teamId") = 1)`);
  let fixed = 0;
  for (const row of solo) {
    try {
      if (await reuniteUser(row.id, "found at startup")) fixed++;
    } catch (err) {
      console.error("[reuniteTeams] couldn't check a person:", err);
    }
  }
  return fixed;
}
