import { db } from "@/db";
import { users, teams, teamInvites, dealMembers, accounts, deals } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { sendEmail } from "./email";
import { APP_OWNER_EMAILS, isAppOwner } from "./appOwner";

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

    await notifyFounderOfSignup({
      userId,
      email,
      name,
      outcome: {
        kind: "joined",
        teamId: invite.teamId,
        invitedByUserId: invite.invitedByUserId,
        restrictToDealId: invite.restrictToDealId,
      },
    });
    return;
  }

  const [team] = await db
    .insert(teams)
    .values({ name: name ? `${name}'s Team` : "My Team", ownerUserId: userId })
    .returning();
  await db.update(users).set({ teamId: team.id }).where(eq(users.id, userId));

  await notifyFounderOfSignup({ userId, email, name, outcome: { kind: "new_team", teamId: team.id } });
}

// Best-effort "someone just signed up" alert to the founder (see
// src/lib/appOwner.ts — defaults to Lucia's own email, comma-separated
// env var to add more). Fires for every new-account path (Google,
// LinkedIn, magic-link, and email+password), since they all funnel
// through assignTeamForNewUser above. Never throws — a failed
// notification email should never be the reason a signup itself fails.
async function notifyFounderOfSignup(params: {
  userId: string;
  email: string;
  name: string | null;
  outcome:
    | { kind: "new_team"; teamId: string }
    | { kind: "joined"; teamId: string; invitedByUserId: string; restrictToDealId: string | null };
}) {
  // Don't email the founder about the founder's own account (e.g. Lucia
  // testing signup herself), and don't bother if no recipient is configured.
  if (isAppOwner(params.email) || APP_OWNER_EMAILS.length === 0) return;

  try {
    const [accountRow] = await db
      .select({ provider: accounts.provider })
      .from(accounts)
      .where(eq(accounts.userId, params.userId))
      .limit(1);

    let signupMethod: string;
    if (accountRow) {
      signupMethod =
        accountRow.provider === "google"
          ? "Google sign-in"
          : accountRow.provider === "linkedin"
            ? "LinkedIn sign-in"
            : `${accountRow.provider} sign-in`;
    } else {
      const [userRow] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, params.userId));
      signupMethod = userRow?.passwordHash ? "Email + password" : "Email link (magic link)";
    }

    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, params.outcome.teamId));

    let teamLine: string;
    if (params.outcome.kind === "new_team") {
      teamLine = `Created a brand-new team, <strong>${team?.name ?? "Untitled team"}</strong> — a self-serve signup, no invite involved.`;
    } else {
      const [inviter] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, params.outcome.invitedByUserId));
      const inviterLabel = inviter ? `${inviter.name || inviter.email} (${inviter.email})` : "someone already on the team";

      let dealLine = "";
      if (params.outcome.restrictToDealId) {
        const [deal] = await db
          .select({ name: deals.name })
          .from(deals)
          .where(eq(deals.id, params.outcome.restrictToDealId));
        dealLine = ` — restricted to just <strong>${deal?.name ?? "one deal"}</strong>, not the whole team's deals`;
      }
      teamLine = `Joined the existing team <strong>${team?.name ?? "Unknown team"}</strong>, invited by ${inviterLabel}${dealLine}.`;
    }

    const displayName = params.name || "(no name given)";
    const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

    await sendEmail({
      to: APP_OWNER_EMAILS,
      subject: `New signup on Anchor: ${displayName} (${params.email})`,
      html: `
        <p><strong>${displayName}</strong> (${params.email}) just signed up for Anchor.</p>
        <ul>
          <li><strong>Signed up:</strong> ${when}</li>
          <li><strong>Method:</strong> ${signupMethod}</li>
          <li><strong>Team:</strong> ${teamLine}</li>
        </ul>
      `,
    });
  } catch (err) {
    console.error("Founder signup-notification email failed:", err);
  }
}
