import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { PROVIDERS, isProviderKey } from "@/lib/integrations/config";
import { fetchIdentityLabel } from "@/lib/integrations/identity";
import { safeReturnTo } from "@/lib/integrations/returnTo";

function baseUrl(req: NextRequest): string {
  return process.env.AUTH_URL || req.nextUrl.origin;
}

function redirectWith(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/dashboard/integrations", baseUrl(req));
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
    return NextResponse.redirect(new URL("/sign-in", baseUrl(req)));
  }

  const { provider } = await params;
  if (!isProviderKey(provider)) {
    return redirectWith(req, { error: "unknown_provider" });
  }

  const oauthError = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  let decodedState: { userId: string; returnTo?: string | null } | null = null;
  try {
    decodedState = state ? JSON.parse(Buffer.from(state, "base64url").toString()) : null;
  } catch {
    decodedState = null;
  }

  if (oauthError) {
    // Declined a permission asked for from a meeting page ("Save to Gmail
    // drafts", "Add to calendar"): go back there, where the button explains
    // what's missing, instead of stranding them on Integrations.
    const returnTo =
      decodedState?.userId === session.user.id ? safeReturnTo(decodedState.returnTo ?? null) : null;
    if (returnTo) return NextResponse.redirect(new URL(returnTo, baseUrl(req)));
    return redirectWith(req, { error: "denied", provider });
  }
  if (!code || !state) {
    return redirectWith(req, { error: "missing_code", provider });
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
    const basicAuth = cfg.tokenAuth === "basic";
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        ...(basicAuth ? { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` } : {}),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        ...(basicAuth ? {} : { client_id: clientId, client_secret: clientSecret }),
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
    // Only Salesforce's token response carries this (a per-org API base
    // URL) — undefined/absent for every other provider, so this is a
    // harmless null for them.
    const instanceUrl = typeof tokenBody.instance_url === "string" ? tokenBody.instance_url : null;

    // Not every re-authorization round hands back a fresh refresh_token —
    // Google's is protected against this (src/lib/integrations/config.ts
    // forces prompt=consent&access_type=offline on every authorize call,
    // guaranteeing one every time), but Microsoft/Slack/Salesforce/HubSpot
    // have no such override, so a RECONNECT (fixing scopes, re-consenting
    // after a revoke) can come back with no refresh_token at all. Only
    // include it in the update's SET when this round actually returned
    // one, so reconnecting never silently overwrites a previously-good
    // refresh token with null — that used to leave a connection looking
    // "Connected" in the UI while quietly unable to refresh once its
    // access token expired.
    // Slack hands back the person's own token alongside the bot token when
    // user scopes were asked for (?add=read_dms); kept separately, and never
    // cleared by a later bot-only reconnect.
    const authedUser = tokenBody.authed_user as { access_token?: unknown } | undefined;
    const userAccessToken = typeof authedUser?.access_token === "string" ? authedUser.access_token : null;
    const userTokenUpdate = userAccessToken ? { userAccessToken } : {};

    const refreshTokenUpdate =
      typeof tokenBody.refresh_token === "string" && tokenBody.refresh_token
        ? { refreshToken: tokenBody.refresh_token }
        : {};

    await db
      .insert(integrationConnections)
      .values({
        userId: session.user.id,
        provider,
        externalAccountEmail: identityLabel,
        accessToken,
        // A brand-new row has no prior refresh token to protect, so null
        // is the correct value here when this round didn't return one.
        refreshToken: tokenBody.refresh_token || null,
        tokenExpiresAt: expiresAt,
        scope: typeof tokenBody.scope === "string" ? tokenBody.scope : cfg.scopes.join(" "),
        instanceUrl,
        userAccessToken,
      })
      .onConflictDoUpdate({
        target: [integrationConnections.userId, integrationConnections.provider],
        set: {
          // A failed lookup this time mustn't wipe the one saved before.
          ...(identityLabel ? { externalAccountEmail: identityLabel } : {}),
          accessToken,
          ...refreshTokenUpdate,
          ...userTokenUpdate,
          tokenExpiresAt: expiresAt,
          scope: typeof tokenBody.scope === "string" ? tokenBody.scope : cfg.scopes.join(" "),
          instanceUrl,
          updatedAt: new Date(),
        },
      });

    const returnTo = safeReturnTo(decodedState.returnTo ?? null);
    if (returnTo) return NextResponse.redirect(new URL(returnTo, baseUrl(req)));
    return redirectWith(req, { connected: provider });
  } catch (err) {
    console.error(`${provider} OAuth callback failed:`, err);
    return redirectWith(req, { error: "callback_failed", provider });
  }
}
