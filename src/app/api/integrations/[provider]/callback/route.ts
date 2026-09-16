import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { PROVIDERS, isProviderKey } from "@/lib/integrations/config";
import { fetchIdentityLabel } from "@/lib/integrations/identity";

function baseUrl(req: NextRequest): string {
  return process.env.AUTH_URL || req.nextUrl.origin;
}

function redirectWith(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/dashboard/integrations", req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

// NOTE: written against each provider's published OAuth docs, but this
// codebase has no real client ID/secret to test against yet — the first
// real connect attempt, once credentials are added, is the real test.
// Slack in particular returns its token in a slightly different place
// depending on the scopes granted (bot vs. user token); this reads the
// top-level access_token, which is correct for the bot-token flow these
// scopes request, but double-check against Slack's response if it errors.
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
    return redirectWith(req, { error: "unknown_provider" });
  }

  const oauthError = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  if (oauthError) {
    return redirectWith(req, { error: "denied", provider });
  }
  if (!code || !state) {
    return redirectWith(req, { error: "missing_code", provider });
  }

  let decodedState: { userId: string } | null = null;
  try {
    decodedState = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    decodedState = null;
  }
  if (!decodedState || decodedState.userId !== session.user.id) {
    return redirectWith(req, { error: "state_mismatch", provider });
  }

  const cfg = PROVIDERS[provider];
  const clientId = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret) {
    return redirectWith(req, { error: "not_configured", provider });
  }

  const redirectUri = `${baseUrl(req)}/api/integrations/${provider}/callback`;

  try {
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    const accessToken = tokenBody.access_token;
    if (!tokenRes.ok || !accessToken) {
      console.error(`${provider} token exchange failed:`, tokenBody);
      return redirectWith(req, { error: "token_exchange", provider });
    }

    const expiresAt =
      typeof tokenBody.expires_in === "number"
        ? new Date(Date.now() + tokenBody.expires_in * 1000)
        : null;
    const identityLabel = await fetchIdentityLabel(provider, accessToken, tokenBody);

    await db
      .insert(integrationConnections)
      .values({
        userId: session.user.id,
        provider,
        externalAccountEmail: identityLabel,
        accessToken,
        refreshToken: tokenBody.refresh_token || null,
        tokenExpiresAt: expiresAt,
        scope: typeof tokenBody.scope === "string" ? tokenBody.scope : cfg.scopes.join(" "),
      })
      .onConflictDoUpdate({
        target: [integrationConnections.userId, integrationConnections.provider],
        set: {
          externalAccountEmail: identityLabel,
          accessToken,
          refreshToken: tokenBody.refresh_token || null,
          tokenExpiresAt: expiresAt,
          scope: typeof tokenBody.scope === "string" ? tokenBody.scope : cfg.scopes.join(" "),
          updatedAt: new Date(),
        },
      });

    return redirectWith(req, { connected: provider });
  } catch (err) {
    console.error(`${provider} OAuth callback failed:`, err);
    return redirectWith(req, { error: "callback_failed", provider });
  }
}
