import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { PROVIDERS, isProviderConfigured, isProviderKey } from "@/lib/integrations/config";
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
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const { provider } = await params;
  if (!isProviderKey(provider)) {
    return NextResponse.redirect(new URL("/dashboard/integrations?error=unknown_provider", req.url));
  }
  if (!isProviderConfigured(provider)) {
    return NextResponse.redirect(
      new URL(`/dashboard/integrations?error=not_configured&provider=${provider}`, req.url)
    );
  }

  const cfg = PROVIDERS[provider];
  const clientId = process.env[cfg.clientIdEnv]!;
  const redirectUri = `${baseUrl(req)}/api/integrations/${provider}/callback`;

  // Ties this authorize request to the signed-in user so the callback can
  // confirm the token that comes back belongs to the same person who
  // started the flow — checked again on the way back in callback/route.ts.
  const state = Buffer.from(
    JSON.stringify({ userId: session.user.id, nonce: crypto.randomUUID() })
  ).toString("base64url");

  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scopes.join(" "));
  url.searchParams.set("state", state);
  for (const [k, v] of Object.entries(cfg.extraAuthorizeParams || {})) {
    url.searchParams.set(k, v);
  }

  return NextResponse.redirect(url.toString());
}
