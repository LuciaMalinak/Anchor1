import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import LinkedIn from "next-auth/providers/linkedin";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
  teams,
  teamInvites,
  dealMembers,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// Only registered when the LinkedIn app's credentials are actually set —
// so the app still runs fine (email sign-in only) before that's set up,
// instead of crashing on a missing clientId.
const linkedInConfigured = Boolean(
  process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET
);

export const {
  handlers: { GET, POST },
  signIn,
  signOut,
  auth,
} = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  // Render (like Railway/Fly, unlike Vercel) isn't auto-detected as a
  // trusted host by Auth.js, so without this every request is rejected
  // with "UntrustedHost" even though AUTH_URL is set correctly.
  trustHost: true,
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM,
    }),
    ...(linkedInConfigured
      ? [
          LinkedIn({
            clientId: process.env.LINKEDIN_CLIENT_ID,
            clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
            // Lets a LinkedIn sign-in merge into an existing account that
            // was created via email with the same address, instead of
            // erroring. Normally a real security tradeoff (it trusts that
            // every provider verified the email correctly) — acceptable
            // here since Resend and LinkedIn both only report verified
            // emails, and this is a small, single-team app for now.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        // Just a boolean — never the hash itself — so the proxy can gate
        // /dashboard on "has this person set a password yet" without an
        // extra DB query on every request (database-session `user` here
        // already carries every users-table column, including this one).
        session.user.hasPassword = Boolean(
          (user as typeof user & { passwordHash: string | null }).passwordHash
        );
      }
      return session;
    },
  },
  events: {
    // Runs once, right after the Drizzle adapter inserts a brand-new user
    // row. Every user needs a team: if someone already on a team invited
    // this email address, join that team (and clear the invite); otherwise
    // this is a new account on its own, so give it a fresh team of one.
    async createUser({ user }) {
      if (!user.id || !user.email) return;

      const [invite] = await db
        .select()
        .from(teamInvites)
        .where(sql`lower(${teamInvites.email}) = lower(${user.email})`)
        .limit(1);

      if (invite) {
        await db
          .update(users)
          .set({
            teamId: invite.teamId,
            // Set only for an invite that came from an approved join
            // request naming one deal (see
            // /api/join-requests/[id]/approve) — an ordinary teammate
            // invite leaves this false, same as always.
            restrictedToDeals: Boolean(invite.restrictToDealId),
          })
          .where(eq(users.id, user.id));
        if (invite.restrictToDealId) {
          await db
            .insert(dealMembers)
            .values({ dealId: invite.restrictToDealId, userId: user.id })
            .onConflictDoNothing();
        }
        await db
          .delete(teamInvites)
          .where(sql`lower(${teamInvites.email}) = lower(${user.email})`);
        return;
      }

      const [team] = await db
        .insert(teams)
        .values({ name: user.name ? `${user.name}'s Team` : "My Team" })
        .returning();
      await db.update(users).set({ teamId: team.id }).where(eq(users.id, user.id));
    },
  },
});
