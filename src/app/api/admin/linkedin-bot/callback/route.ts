import { NextRequest, NextResponse } from "next/server";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { exchangeCode, listAdminPages } from "@/lib/linkedinBot/api";
import { updateBot } from "@/lib/linkedinBot/run";

function baseUrl(req: NextRequest): string {
  return process.env.AUTH_URL || req.nextUrl.origin;
}

// LinkedIn sends the admin back here after approving. Saves the tokens
// and picks the company Page to post as (the one named like Anchor, if
// the account runs several).
export async function GET(req: NextRequest) {
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/dashboard/admin/linkedin?${q}`, baseUrl(req)));
    res.cookies.delete("li_bot_state");
    return res;
  };
  if (!(await requireAppOwnerApi())) return NextResponse.redirect(new URL("/dashboard", baseUrl(req)));
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back(`error=${encodeURIComponent(params.get("error_description") ?? params.get("error")!)}`);
  const code = params.get("code");
  if (!code || !params.get("state") || params.get("state") !== req.cookies.get("li_bot_state")?.value) {
    return back("error=state");
  }
  try {
    const tokens = await exchangeCode(code, `${baseUrl(req)}/api/admin/linkedin-bot/callback`);
    const pages = await listAdminPages(tokens.accessToken);
    if (!pages.length) return back("error=no_page");
    const page = pages.find((p) => /anchor/i.test(p.name)) ?? pages[0];
    await updateBot({
      orgUrn: page.urn,
      orgName: page.name,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.tokenExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      lastError: null,
    });
    return back("connected=1");
  } catch (err) {
    console.error("[linkedinBot] connecting the Page failed:", err);
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : "connect_failed")}`);
  }
}
