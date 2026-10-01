import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  GOOGLE_EXTRA_SCOPES,
  HUBSPOT_EXTRA_SCOPES,
  PROVIDERS,
  isGoogleExtraScopeKey,
  isHubspotExtraScopeKey,
  isProviderConfigured,
  isProviderKey,
} from "@/lib/integrations/config";
import { safeReturnTo } from "@/lib/integrations/returnTo";
import crypto from "crypto";

// Same fallback used by auth.ts's trustHost setting: prefer the explicit
// URL when it's set (needed behind Render's proxy), otherwise derive it
// from the incoming request.
function baseUrl(req: NextRequest): string {
  return process.env.AUTH_URL || req.nextUrl.origin;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/sign-in", baseUrl(req)));
  }

  const { provider } = await params;
  if (!isProviderKey(provider)) {
    return NextResponse.redirect(new URL("/dashboard/integrations?error=unknown_provider", baseUrl(req)));
  }
  if (!isProviderConfigured(provider)) {
    return NextResponse.redirect(
      new URL(`/dashboard/integrations?error=not_configured&provider=${provider}`, baseUrl(req))
    );
  }

  const cfg = PROVIDERS[provider];
  const clientId = process.env[cfg.clientIdEnv]!;
  const redirectUri = `${baseUrl(req)}/api/integrations/${provider}/callback`;

  // Ties this authorize request to the signed-in user so the callback can
  // confirm the token that comes back belongs to the same person who
  // started the flow — checked again on the way back in callback/route.ts.
  //
  // returnTo sends them back to the page they started from (e.g. a
  // meeting's "Save to Gmail drafts") instead of the Integrations page.
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const state = Buffer.from(
    JSON.stringify({ userId: session.user.id, nonce: crypto.randomUUID(), returnTo })
  ).toString("base64url");

  // ?add=gmail_compose / calendar_events asks for one extra Google
  // permission on top of the default read-only ones (see config.ts).
  const add = req.nextUrl.searchParams.get("add");
  // ?add=deals_write on HubSpot does the same for updating deals.
  const scopes =
    provider === "google" && isGoogleExtraScopeKey(add)
      ? [...cfg.scopes, GOOGLE_EXTRA_SCOPES[add]]
      : provider === "hubspot" && isHubspotExtraScopeKey(add)
        ? [...cfg.scopes, HUBSPOT_EXTRA_SCOPES[add]]
        : cfg.scopes;

  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  for (const [k, v] of Object.entries(cfg.extraAuthorizeParams || {})) {
    url.searchParams.set(k, v);
  }

  return NextResponse.redirect(url.toString());
}
