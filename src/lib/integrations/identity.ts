import type { ProviderKey } from "./config";

// Best-effort label for what's shown next to "Connected" on the
// Integrations page — an email address for Google/Microsoft, a workspace
// name for Slack (which doesn't hand back an email in this flow). Never
// blocks the connection itself: if this lookup fails, the token is still
// stored and the card just shows "Connected" without a specific account.
export async function fetchIdentityLabel(
  key: ProviderKey,
  accessToken: string,
  tokenResponseBody: Record<string, unknown>
): Promise<string | null> {
  try {
    if (key === "dropbox") {
      const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body.email === "string" ? body.email : null;
    }
    if (key === "google") {
      // The id_token (scope "openid email") already names the account;
      // the userinfo call is only needed when it's missing.
      const fromIdToken = emailFromIdToken(tokenResponseBody.id_token);
      if (fromIdToken) return fromIdToken;
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body.email === "string" ? body.email : null;
    }
    if (key === "microsoft") {
      const res = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const body = await res.json();
      return (body.mail || body.userPrincipalName) ?? null;
    }
    if (key === "slack") {
      const team = tokenResponseBody.team as { name?: string } | undefined;
      return team?.name ? `${team.name} workspace` : null;
    }
    if (key === "salesforce") {
      const instanceUrl = tokenResponseBody.instance_url as string | undefined;
      if (!instanceUrl) return null;
      const res = await fetch(`${instanceUrl}/services/oauth2/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body.email === "string" ? body.email : null;
    }
    if (key === "zoom") {
      const res = await fetch("https://api.zoom.us/v2/users/me", { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body.email === "string" ? body.email : null;
    }
    if (key === "hubspot") {
      // HubSpot's one-call way to identify a token: no separate
      // "userinfo" endpoint, just this lookup by the token itself, which
      // hands back the connecting user's email and the HubSpot account
      // ("hub") domain.
      const res = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`);
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body.user === "string" ? body.user : (body.hub_domain ?? null);
    }
  } catch (err) {
    console.error(`Couldn't fetch ${key} identity label:`, err);
  }
  return null;
}

// The email claim of an OpenID id_token (a JWT straight from Google's
// token endpoint over TLS, so reading it without verifying is fine here:
// it's only a label).
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}
