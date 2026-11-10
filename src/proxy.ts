import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, teams, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sessionCookieName, absoluteUrl } from "@/lib/auth/password";
import { recordSeen } from "@/lib/lastSeen";

// Deliberately NOT using next-auth's `auth((req) => {...})` wrapper here.
// That wrapper runs Auth.js's full session action on every request, which
// unconditionally re-issues the session cookie with the app's one static
// `session.maxAge` (30 days) — silently overwriting the shorter, "stay
// signed in"-aware cookie the password-sign-in route sets on purpose (see
// src/app/api/auth/password-sign-in/route.ts). Reading the session
// ourselves, directly from the same `session` table Auth.js already uses,
// gets the same protection without that side effect.
export default async function proxy(req: NextRequest) {
  const isProtected = req.nextUrl.pathname.startsWith("/dashboard");
  if (!isProtected) return NextResponse.next();

  const signInUrl = absoluteUrl("/sign-in", req);
  const token = req.cookies.get(sessionCookieName())?.value;
  if (!token) {
    return NextResponse.redirect(signInUrl);
  }

  const [row] = await db
    .select({
      userId: sessions.userId,
      expires: sessions.expires,
      passwordHash: users.passwordHash,
      twoFactorEnabledAt: users.twoFactorEnabledAt,
      twoFactorVerifiedAt: sessions.twoFactorVerifiedAt,
      requireTwoFactor: teams.requireTwoFactor,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(teams, eq(teams.id, users.teamId))
    .where(eq(sessions.sessionToken, token))
    .limit(1);

  if (!row || row.expires.getTime() < Date.now()) {
    return NextResponse.redirect(signInUrl);
  }

  // Two-step verification: on for this person but not done for this
  // sign-in yet -> enter the code first (src/lib/auth/twoFactor.ts).
  if (row.twoFactorEnabledAt && !row.twoFactorVerifiedAt) {
    const url = absoluteUrl("/sign-in/two-factor", req);
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Everyone's guided to set a password right after their first sign-in
  // (whichever method got them in) — sent here instead of into the
  // dashboard until they have. See src/app/welcome/set-password/page.tsx.
  if (!row.passwordHash) {
    return NextResponse.redirect(absoluteUrl("/welcome/set-password", req));
  }

  // Their team requires two-step verification and they haven't turned it
  // on: set it up before anything else.
  if (row.requireTwoFactor && !row.twoFactorEnabledAt) {
    return NextResponse.redirect(absoluteUrl("/welcome/two-factor", req));
  }

  // For the admin pages' "last used Anchor" — throttled, never blocks.
  void recordSeen(row.userId);

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
