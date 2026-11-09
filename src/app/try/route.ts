import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

// The free-trial link (/try, or /try?code=OTHER): remembers the promo code
// in a cookie, then sends the visitor to sign up (or straight to the plans
// page if they're already signed in), where the code is applied for them.
const PROMO_COOKIE = "anchor_promo";
const DEFAULT_CODE = "TRYANCHOR";

function baseUrl(req: NextRequest): string {
  return (process.env.AUTH_URL || req.nextUrl.origin).replace(/\/$/, "");
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("code") || DEFAULT_CODE;
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40) || DEFAULT_CODE;
  const billing = `/billing?promo=${encodeURIComponent(code)}`;
  const session = await auth();
  const target = session?.user?.id ? billing : `/sign-up?next=${encodeURIComponent(billing)}`;
  const res = NextResponse.redirect(new URL(target, baseUrl(req)));
  res.cookies.set(PROMO_COOKIE, code, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 30 * 24 * 3600, path: "/" });
  return res;
}
