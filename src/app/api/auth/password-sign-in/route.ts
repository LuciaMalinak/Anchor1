import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";
import { sql } from "drizzle-orm";
import { verifyPassword, sessionCookieName, secureCookiesEnabled, absoluteUrl } from "@/lib/auth/password";

// How long the underlying session row (and, when "stay signed in" is
// checked, the cookie itself) stays valid. Unchecked still gets a real
// session — just a short-lived one, and a cookie with no Max-Age at all so
// the browser drops it on its own when the browser closes.
const REMEMBER_ME_DAYS = 90;
const DEFAULT_SESSION_DAYS = 1;

function backToSignIn(req: NextRequest, error: string) {
  const url = absoluteUrl("/sign-in", req);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const rememberMe = form.get("rememberMe") != null;

  if (!email || !password) {
    return backToSignIn(req, "missing");
  }

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  // Same generic error either way — don't reveal whether the email exists
  // or whether it just doesn't have a password set yet.
  if (!user || !user.passwordHash) {
    return backToSignIn(req, "invalid");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return backToSignIn(req, "invalid");
  }

  const days = rememberMe ? REMEMBER_ME_DAYS : DEFAULT_SESSION_DAYS;
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + days * 86_400_000);
  await db.insert(sessions).values({ sessionToken: token, userId: user.id, expires });

  const res = NextResponse.redirect(absoluteUrl("/dashboard", req), { status: 303 });
  res.cookies.set({
    name: sessionCookieName(),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookiesEnabled(),
    // Omitted entirely when not "remembering" — that's what makes it a
    // true session cookie the browser clears on its own when it closes,
    // rather than one that just says so via an early expiry date.
    ...(rememberMe ? { maxAge: days * 86_400 } : {}),
  });
  return res;
}
