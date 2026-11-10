import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import LinkedIn from "next-auth/providers/linkedin";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
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

// "Sign in with Microsoft" for company Microsoft 365 / Entra ID accounts
// (and personal Microsoft accounts), so a hotel group's IT can manage who
// gets in: someone whose work account is disabled can't sign in this way.
// Registered as a multi-tenant app in the Microsoft Entra admin center.
export const microsoftConfigured = Boolean(
  process.env.MICROSOFT_SIGNIN_CLIENT_ID && process.env.MICROSOFT_SIGNIN_CLIENT_SECRET
);

// Microsoft's "email" claim isn't verified (any tenant admin can type any
// address into it), so trusting it would let someone take over another
// person's Anchor.AI account by email. The sign-in name (UPN) is safer: a
// work account's UPN must use a domain its organisation has proven it
// owns, and a personal account's is the verified Microsoft account email.
// Guest accounts (#EXT#) and anything without a usable name are refused.
function microsoftEmail(profile: Record<string, unknown>): string | null {
  const upn = typeof profile.preferred_username === "string" ? profile.preferred_username.trim().toLowerCase() : "";
  if (!upn || upn.includes("#ext#") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(upn)) return null;
  return upn;
}

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
    ...(microsoftConfigured
      ? [
          MicrosoftEntraID({
            clientId: process.env.MICROSOFT_SIGNIN_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_SIGNIN_CLIENT_SECRET,
            issuer: "https://login.microsoftonline.com/common/v2.0",
            authorization: { params: { scope: "openid profile email" } },
            // Only the verified sign-in name, never a downloaded photo
            // (the default stores the picture inline in the database).
            profile(profile) {
              const email = microsoftEmail(profile as unknown as Record<string, unknown>);
              return { id: String(profile.sub), name: typeof profile.name === "string" ? profile.name : null, email: email ?? "", image: null };
            },
            // Safe with the verified sign-in name above (see microsoftEmail).
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
    // Without this, Auth.js falls back to its own built-in error page for
    // ANY unexpected failure during sign-in — not just genuine
    // misconfiguration. That page is a bare, unbranded "Server error /
    // There is a problem with the server configuration. Check the server
    // logs for more information." screen with zero Anchor styling, and
    // it's exactly what a transient SendGrid failure while sending the
    // magic-link email (see the Resend provider above) triggers, since
    // that throw isn't a "safe" Auth.js error type and Auth.js maps any
    // unsafe error to the generic "Configuration" type. Routing it back
    // to our own /sign-in page instead means a real user only ever sees
    // Anchor's own UI, with a plain-English message (see
    // SIGN_IN_ERROR_COPY in that page) instead of a scary crash screen.
    error: "/sign-in",
  },
  callbacks: {
    // A Microsoft account without a usable verified sign-in name (see
    // microsoftEmail above) is turned away with an explanation.
    signIn({ account, user }) {
      if (account?.provider === "microsoft-entra-id" && !user.email) return "/sign-in?error=MicrosoftAccount";
      return true;
    },
    session({ session, user }) {
      // Two-step verification turned on but not done yet for this sign-in:
      // nobody is signed in as far as every page and API is concerned,
      // until /sign-in/two-factor marks the session verified.
      const u = user as typeof user & { twoFactorEnabledAt?: Date | null };
      const s = session as typeof session & { twoFactorVerifiedAt?: Date | null };
      if (u.twoFactorEnabledAt && !s.twoFactorVerifiedAt) {
        // user: undefined explicitly: next-auth's server-side auth() adds
        // the database user back unless the session sets the key itself.
        return { expires: session.expires, user: undefined } as unknown as typeof session;
      }
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
