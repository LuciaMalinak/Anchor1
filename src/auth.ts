import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import LinkedIn from "next-auth/providers/linkedin";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";

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
      }
      return session;
    },
  },
});
