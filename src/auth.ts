import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import LinkedIn from "next-auth/providers/linkedin";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/db/schema";
import { signInEmailHtml } from "@/lib/emailTemplates";
import { assignTeamForNewUser } from "@/lib/onboardUser";
import { sendEmail } from "@/lib/email";

// Only registered when the LinkedIn app's credentials are actually set —
// so the app still runs fine (email sign-in only) before that's set up,
// instead of crashing on a missing clientId.
const linkedInConfigured = Boolean(
  process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET
);

// Same idea for Google — this is a separate, plain NextAuth *sign-in*
// provider (its own Google Cloud OAuth client), distinct from the
// GOOGLE_INTEGRATION_CLIENT_ID/SECRET pair used by the Integrations page
// to read Gmail/Calendar data. Different purpose, different credentials,
// so they don't share env vars even though both talk to Google.
const googleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
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
    // Despite the name/import (next-auth doesn't ship a generic "Email"
    // provider preset with this API — Resend's is the closest shape, and
    // overriding sendVerificationRequest entirely means the provider
    // itself is really just a config skeleton), this actually sends
    // through SendGrid now, same as every other email in the app — see
    // src/lib/email.ts. It used to call Resend's API directly with its
    // own RESEND_API_KEY, a leftover from before the invite/recap emails
    // were switched to SendGrid; that key was never kept current after
    // the switch, which is why magic-link sign-in emails silently
    // stopped sending. apiKey/from below are unused (sendEmail reads
    // SENDGRID_API_KEY/SENDGRID_FROM_EMAIL itself) but next-auth's type
    // for this provider still expects them.
    Resend({
      apiKey: process.env.SENDGRID_API_KEY,
      from: process.env.SENDGRID_FROM_EMAIL,
      async sendVerificationRequest({ identifier: to, url }) {
        const { host, origin } = new URL(url);
        // Email the real (single-use, token-carrying) callback URL only
        // as a query param on our own confirmation page — not directly —
        // so an email client's automatic link-prescanning can't consume
        // it before the person actually clicks. See
        // src/app/sign-in/verify/page.tsx for the other half of this.
        const confirmUrl = `${origin}/sign-in/verify?url=${encodeURIComponent(url)}`;
        await sendEmail({
          to,
          subject: `Sign in to ${host}`,
          html: signInEmailHtml({ url: confirmUrl, host }),
        });
      },
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
    ...(googleConfigured
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // Same tradeoff as LinkedIn above, same reasoning: Google only
            // reports verified emails too.
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
      await assignTeamForNewUser(user.id, user.email, user.name ?? null);
    },
  },
});
