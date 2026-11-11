import { createHash } from "crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, rawClient } from "@/db";
import { teams, users } from "@/db/schema";
import { logDataChange } from "@/lib/dataChangeLog";

// Deleting an account never deletes the work in it: the team, deals,
// calls, contacts and files stay (see /api/profile/delete), only the
// person's sign-in and personal details go. This is the other half: when
// they come back and sign up again with the same email, everything is
// theirs again, so they pick up where they left off.
// - The deleted row keeps only a SHA-256 of the email (not the email) and
//   the id of the team they owned.
// - On sign-up, every reference to the old account (meetings, contacts,
//   tasks, what Ask Anchor learned, …) moves to the new one, found from the
//   database's own foreign keys so new tables are included automatically.
// - This is for people who owned their team (a client's own account); a
//   former member's work stays with the company team they were on, and
//   they rejoin it only by a new invite.

export const emailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

export async function rememberDeletedAccount(userId: string, email: string, ownedTeamId: string | null) {
  await db
    .update(users)
    .set({ deletedEmailHash: emailHash(email), deletedAt: new Date(), deletedOwnedTeamId: ownedTeamId })
    .where(eq(users.id, userId));
}

// Never moved: sign-ins and app tokens belong to the old account only.
const SKIP_TABLES = new Set(["session", "account", "verificationToken", "api_token", "user"]);

// Returns the team to put them back on, if any.
export async function restoreReturningAccount(newUserId: string, email: string): Promise<{ teamId: string | null } | null> {
  const [old] = await db
    .select()
    .from(users)
    .where(and(eq(users.deletedEmailHash, emailHash(email)), ne(users.id, newUserId)))
    .orderBy(desc(users.deletedAt))
    .limit(1);
  // Only someone who owned their team gets everything back automatically:
  // a former member's work belongs to the company team they were on, and
  // they rejoin it only by a new invite.
  if (!old?.deletedOwnedTeamId) return null;

  const refs = await rawClient<{ table_name: string; column_name: string }[]>`
    select kcu.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
      and ccu.table_name = 'user' and ccu.column_name = 'id'`;
  const moved: string[] = [];
  const kept: string[] = [];
  for (const { table_name, column_name } of refs) {
    if (SKIP_TABLES.has(table_name)) continue;
    const t = `"${table_name.replace(/"/g, '""')}"`;
    const c = `"${column_name.replace(/"/g, '""')}"`;
    try {
      // Each table on its own, so one clash (e.g. a setting the new
      // account already has) doesn't stop the rest.
      const n = await rawClient.begin(async (tx) => (await tx.unsafe(`update ${t} set ${c} = $1 where ${c} = $2`, [newUserId, old.id])).count);
      if (n) moved.push(`${table_name}.${column_name}: ${n}`);
    } catch {
      kept.push(`${table_name}.${column_name}`);
    }
  }
  // Ownership of their own team, when nobody else has taken it on.
  let teamId: string | null = null;
  if (old.deletedOwnedTeamId) {
    const [team] = await db.select().from(teams).where(eq(teams.id, old.deletedOwnedTeamId));
    const others = team
      ? await db.select({ id: users.id }).from(users).where(and(eq(users.teamId, team.id), ne(users.id, newUserId))).limit(1)
      : [];
    if (team && (team.ownerUserId === newUserId || team.ownerUserId === old.id || !team.ownerUserId) && others.length === 0) {
      await db.update(teams).set({ ownerUserId: newUserId }).where(eq(teams.id, team.id));
      teamId = team.id;
    }
  }
  await db.update(users).set({ deletedEmailHash: null }).where(eq(users.id, old.id));
  await logDataChange({
    action: "user_restored",
    actorUserId: newUserId,
    teamId,
    targetId: newUserId,
    details: { reason: "returned after deleting their account", previousAccount: old.id, moved, kept },
  });
  return { teamId };
}
