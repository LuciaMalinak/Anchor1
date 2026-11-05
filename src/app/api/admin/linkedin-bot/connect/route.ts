import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { authorizeUrl, pageAppConfigured } from "@/lib/linkedinBot/api";

function baseUrl(req: NextRequest): string {
  return process.env.AUTH_URL || req.nextUrl.origin;
}

// Starts connecting the company Page: sends the admin to LinkedIn to
// approve posting as the Page.
export async function GET(req: NextRequest) {
  if (!(await requireAppOwnerApi())) return NextResponse.redirect(new URL("/dashboard", baseUrl(req)));
  if (!pageAppConfigured()) {
    return NextResponse.redirect(new URL("/dashboard/admin/linkedin?error=not_configured", baseUrl(req)));
  }
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authorizeUrl(`${baseUrl(req)}/api/admin/linkedin-bot/callback`, state));
  res.cookies.set("li_bot_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
