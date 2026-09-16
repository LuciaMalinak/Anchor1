import { db } from "@/db";
import { users, teams } from "@/db/schema";
import { eq } from "drizzle-orm";

// Every user is supposed to get a team the moment their account is
// created (see the `createUser` event in src/auth.ts). This covers the
// one case that misses: accounts created before the `teamId` column
// existed. Safe to call on every request — it's a no-op once the user
// has a team.
export async function getOrCreateTeamId(userId: string): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user?.teamId) return user.teamId;

  const [team] = await db
    .insert(teams)
    .values({ name: user?.name ? `${user.name}'s Team` : "My Team" })
    .returning();
  await db.update(users).set({ teamId: team.id }).where(eq(users.id, userId));
  return team.id;
}
