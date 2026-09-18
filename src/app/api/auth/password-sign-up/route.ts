import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import {
  hashPassword,
  sessionCookieName,
  secureCookiesEnabled,
  absoluteUrl,
} from "@/lib/auth/password";
import { assignTeamForNewUser } from "@/lib/onboardUser";
import { isIndustryKey } from "@/lib/industries";

// Creates an account directly with an email + password — no email has to
// be sent or received. This exists specifically so anyone (an investor
// trying the prototype, a prospective customer, anyone without a
// LinkedIn/Google login handy) can sign themselves up on the spot: the
// Resend "magic link" sign-in only delivers to this app's own verified
// address until a sending domain is set up (see src/auth.ts's Resend
// provider), and Google/LinkedIn both depend on Lucia having registered
// and configured those apps. This route has no such dependency.
const SESSION_DAYS = 90;

function backToSignUp(req: NextRequest, error: string, industry: string | null) {
  const url = absoluteUrl("/sign-up", req);
  url.searchParams.set("error", error);
  if (industry) url.searchParams.set("industry", industry);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");
  const industryRaw = String(form.get("industry") ?? "");
  const industry = isIndustryKey(industryRaw) ? industryRaw : null;

  if (!email || !password) {
    return backToSignUp(req, "missing", industry);
  }
  if (password.length < 8) {
    return backToSignUp(req, "short", industry);
  }
  if (password !== confirmPassword) {
    return backToSignUp(req, "mismatch", industry);
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  let userId: string;
  const passwordHash = await hashPassword(password);

  if (existing) {
    // An account with this email already exists — most likely someone
    // who was invited to a team (a row gets created for an invite before
    // the person ever signs in) or who tried the email-link option
    // before. If it already has a password, this is a returning user who
    // should sign in instead, not create a second account.
    if (existing.passwordHash) {
      return backToSignUp(req, "exists", industry);
    }
    await db
      .update(users)
      .set({ passwordHash, name: existing.name ?? (name || null) })
      .where(eq(users.id, existing.id));
    userId = existing.id;
    // Team assignment already happened when this row was first created
    // (an invite, or a prior OAuth/email sign-in) — nothing to redo here.
  } else {
    const [created] = await db
      .insert(users)
      .values({ name: name || null, email, passwordHash })
      .returning();
    userId = created.id;
    await assignTeamForNewUser(userId, email, name || null);
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ sessionToken: token, userId, expires });

  // Same mechanism the other sign-in paths use to carry an industry
  // choice from a homepage link through to the dashboard — see
  // /dashboard's setIndustry handling, which only applies it for a fresh
  // team this user owns.
  const dashboardPath = industry ? `/dashboard?setIndustry=${industry}` : "/dashboard";
  const res = NextResponse.redirect(absoluteUrl(dashboardPath, req), { status: 303 });
  res.cookies.set({
    name: sessionCookieName(),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookiesEnabled(),
    maxAge: SESSION_DAYS * 86_400,
  });
  return res;
}
