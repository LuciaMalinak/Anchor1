import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sessionCookieName } from "@/lib/auth/password";

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

  const signInUrl = new URL("/sign-in", req.nextUrl.origin);
  const token = req.cookies.get(sessionCookieName())?.value;
  if (!token) {
    return NextResponse.redirect(signInUrl);
  }

  const [row] = await db
    .select({ expires: sessions.expires, passwordHash: users.passwordHash })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.sessionToken, token))
    .limit(1);

  if (!row || row.expires.getTime() < Date.now()) {
    return NextResponse.redirect(signInUrl);
  }

  // Everyone's guided to set a password right after their first sign-in
  // (whichever method got them in) — sent here instead of into the
  // dashboard until they have. See src/app/welcome/set-password/page.tsx.
  if (!row.passwordHash) {
    return NextResponse.redirect(new URL("/welcome/set-password", req.nextUrl.origin));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
