import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, apiTokens, deals, integrationConnections, morningBriefs, sessions, teams, users } from "@/db/schema";
import { logDataChange } from "@/lib/dataChangeLog";
import { rememberDeletedAccount } from "@/lib/accountReturn";

// Deletes a person's account: signed out everywhere, email and personal
// details removed, off their team. Used when someone deletes their own
// account (Profile) and when the app owner deletes a client's account
// (Admin → Billing).
//
// Deliberately never a hard DELETE on the user row: a few columns
// reference users.id with no onDelete rule (deals.createdByUserId,
// dealFiles.uploadedByUserId, teamInvites.invitedByUserId), so a real
// delete would fail for almost anyone who created a deal or uploaded a
// file. Anonymizing gets the same result for the person without breaking
// other people's shared deals. The team and its data are kept, with
// nobody on it, so a mistaken delete can be undone (and signing up again
// with the same email gives everything back, accountReturn.ts).
export async function anonymizeAccount(
  userId: string,
  actor: { userId: string; email: string | null; reason: string },
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return;

  if (user.teamId) {
    await db.update(deals).set({ leadUserId: null }).where(and(eq(deals.teamId, user.teamId), eq(deals.leadUserId, userId)));
    await db.update(deals).set({ backupUserId: null }).where(and(eq(deals.teamId, user.teamId), eq(deals.backupUserId, userId)));
  }

  await logDataChange({
    action: "account_deleted",
    actorUserId: actor.userId,
    actorEmail: actor.email,
    teamId: user.teamId,
    targetId: userId,
    details: { email: user.email, name: user.name, reason: actor.reason },
  });

  let ownedTeamId: string | null = null;
  if (user.teamId) {
    const [team] = await db.select({ ownerUserId: teams.ownerUserId }).from(teams).where(eq(teams.id, user.teamId));
    if (team?.ownerUserId === userId) ownedTeamId = user.teamId;
  }
  if (user.email) await rememberDeletedAccount(userId, user.email, ownedTeamId);
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(apiTokens).where(eq(apiTokens.userId, userId));
  // Every connected tool (Gmail, Calendar, Outlook, Slack, CRMs…) and the
  // morning brief: nothing keeps reading, drafting or emailing for an
  // account that's gone.
  await db.delete(integrationConnections).where(eq(integrationConnections.userId, userId));
  await db.delete(morningBriefs).where(eq(morningBriefs.userId, userId));
  await db
    .update(users)
    .set({
      name: null,
      // Freed for reuse and impossible to sign in with (unique, not null).
      email: `deleted-${randomUUID()}@anchor.invalid`,
      emailVerified: null,
      image: null,
      passwordHash: null,
      title: null,
      phone: null,
      linkedin: null,
      department: null,
      otherInfo: null,
      dailyDigestOptIn: false,
      teamId: null,
    })
    .where(eq(users.id, userId));
}
