import { db } from "@/db";
import { users, teams, teamInvites } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email";

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
    .values({ name: user?.name ? `${user.name}'s Team` : "My Team", ownerUserId: userId })
    .returning();
  await db.update(users).set({ teamId: team.id }).where(eq(users.id, userId));
  return team.id;
}

// Shared by the two ways an invite gets created: a teammate typing an
// email into "Invite a teammate" on the Team page (restrictToDealId
// null — full team access, as always), and approving a join request
// (restrictToDealId set to whichever deal was picked — see
// /api/join-requests/[id]/approve). Either way, whoever signs in with
// this email joins the team automatically; see the `createUser` event
// in src/auth.ts, which also applies restrictToDealId if it's set.
export async function createInviteAndNotify({
  teamId,
  email,
  invitedByUserId,
  invitedByEmail,
  restrictToDealId = null,
}: {
  teamId: string;
  email: string;
  invitedByUserId: string;
  invitedByEmail: string;
  restrictToDealId?: string | null;
}) {
  const [invite] = await db
    .insert(teamInvites)
    .values({ teamId, email, invitedByUserId, restrictToDealId })
    .returning();

  let emailWarning: string | null = null;
  try {
    await sendEmail({
      to: email,
      subject: "You've been added to an Anchor team",
      html: `<p>${invitedByEmail} invited you to their team on Anchor.</p><p>Sign in at the same email address to join: <a href="${process.env.AUTH_URL}/sign-in">${process.env.AUTH_URL}/sign-in</a></p>`,
    });
  } catch (err) {
    // Don't fail the invite over email delivery — Resend's shared testing
    // sender can only deliver to the account owner until a domain is
    // verified. The invite record itself still works: whoever signs in
    // with this email joins the team regardless of whether they got a
    // notification about it.
    //
    // The raw provider error used to be shown as-is, which meant a
    // Resend sandbox-mode restriction (and its account email, and a link
    // to resend.com/domains) leaked straight into the product UI. Only
    // ever show a clean, generic explanation here — never err.message.
    const rawMessage = err instanceof Error ? err.message : "";
    emailWarning = rawMessage.includes("testing emails")
      ? "the invite email couldn't be sent yet (Anchor's sender isn't verified for outside recipients)"
      : "the invite email couldn't be sent";
  }

  return { invite, emailWarning };
}
