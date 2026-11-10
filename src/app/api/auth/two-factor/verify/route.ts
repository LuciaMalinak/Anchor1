import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { absoluteUrl, sessionCookieName } from "@/lib/auth/password";
import { clearSignInFailures, clientIp, recordSignInFailure, signInLocked } from "@/lib/auth/signInLimit";
import { markSessionVerified, sessionWithUser, spendRecoveryCode, verifyCode } from "@/lib/auth/twoFactor";
import { safeReturnTo } from "@/lib/integrations/returnTo";

// The second step of signing in: the 6-digit code from the person's
// authenticator app, or one of their recovery codes. Marks this sign-in
// verified (src/lib/auth/twoFactor.ts). Wrong codes count toward the same
// lockout as wrong passwords (src/lib/auth/signInLimit.ts).
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const code = String(form.get("code") ?? "").trim();
  const next = safeReturnTo(typeof form.get("next") === "string" ? String(form.get("next")) : null);
  const token = req.cookies.get(sessionCookieName())?.value;
  const row = await sessionWithUser(token);
  if (!row || !token) return NextResponse.redirect(absoluteUrl("/sign-in", req), { status: 303 });

  const back = (error: string) => {
    const url = absoluteUrl("/sign-in/two-factor", req);
    url.searchParams.set("error", error);
    if (next) url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  };

  const lockKey = `2fa:${row.user.id}`;
  const ip = clientIp(req);
  if (await signInLocked(lockKey, ip)) return back("locked");

  const { user } = row;
  let ok = Boolean(user.twoFactorSecret && verifyCode(user.twoFactorSecret, code));
  if (!ok) {
    const remaining = spendRecoveryCode(user.twoFactorRecoveryHashes, code);
    if (remaining) {
      await db.update(users).set({ twoFactorRecoveryHashes: remaining }).where(eq(users.id, user.id));
      ok = true;
    }
  }
  if (!ok) {
    await recordSignInFailure(lockKey, ip);
    return back("invalid");
  }
  await clearSignInFailures(lockKey);
  await markSessionVerified(token);
  return NextResponse.redirect(absoluteUrl(next ?? "/dashboard", req), { status: 303 });
}
