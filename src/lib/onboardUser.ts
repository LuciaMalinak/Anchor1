import { db } from "@/db";
import { users, teams, teamInvites, dealMembers } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// Shared by every path that creates a brand-new user row: NextAuth's
// adapter (via the `createUser` event in src/auth.ts, used by Google/
// LinkedIn/email-link sign-in) and the plain email+password sign-up route
// (src/app/api/auth/password-sign-up/route.ts), which creates the user row
// itself instead of going through the adapter. Keeping the "join an
// inviter's team, or get a fresh team of your own" decision in one place
// means both paths can never drift apart.
export async function assignTeamForNewUser(
  userId: string,
  email: string,
  name: string | null
) {
  const [invite] = await db
    .select()
    .from(teamInvites)
    .where(sql`lower(${teamInvites.email}) = lower(${email})`)
    .limit(1);

  if (invite) {
    await db
      .update(users)
      .set({
        teamId: invite.teamId,
        // Set only for an invite that came from an approved join request
        // naming one deal (see /api/join-requests/[id]/approve) — an
        // ordinary teammate invite leaves this false, same as always.
        restrictedToDeals: Boolean(invite.restrictToDealId),
      })
      .where(eq(users.id, userId));
    if (invite.restrictToDealId) {
      await db
        .insert(dealMembers)
        .values({ dealId: invite.restrictToDealId, userId })
        .onConflictDoNothing();
    }
    await db
      .delete(teamInvites)
      .where(sql`lower(${teamInvites.email}) = lower(${email})`);
    return;
  }

  const [team] = await db
    .insert(teams)
    .values({ name: name ? `${name}'s Team` : "My Team", ownerUserId: userId })
    .returning();
  await db.update(users).set({ teamId: team.id }).where(eq(users.id, userId));
}
