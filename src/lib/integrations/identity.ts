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
    if (key === "google") {
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
  } catch (err) {
    console.error(`Couldn't fetch ${key} identity label:`, err);
  }
  return null;
}
