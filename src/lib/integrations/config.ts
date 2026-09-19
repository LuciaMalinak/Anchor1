// Provider registry for third-party integrations. Adding a new provider
// (e.g. HubSpot, Salesforce, Zoom) means adding one entry here plus a
// matching identity lookup in identity.ts — the connect/callback/disconnect
// routes and the Integrations page are all provider-agnostic.
//
// Outlook and Teams are deliberately one entry ("microsoft") rather than
// two: both sit behind the same Microsoft identity platform / Graph API,
// so a single Azure AD app registration (one client ID/secret) covers
// both with different scopes. Presenting them as two separate "connect"
// buttons would just mean asking for the same credentials twice.
export type ProviderKey = "google" | "microsoft" | "slack" | "salesforce" | "hubspot";

export type ProviderConfig = {
  key: ProviderKey;
  name: string;
  description: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  extraAuthorizeParams?: Record<string, string>;
};

export const PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  google: {
    key: "google",
    name: "Google (Gmail + Calendar)",
    description:
      "See the email threads and calendar invites around a deal, not just what was said in a recorded meeting.",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_INTEGRATION_CLIENT_ID",
    clientSecretEnv: "GOOGLE_INTEGRATION_CLIENT_SECRET",
    // Ask for a refresh token every time and force the consent screen, so
    // reconnecting after a revoke doesn't silently reuse a stale grant.
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  },
  microsoft: {
    key: "microsoft",
    name: "Microsoft 365 (Outlook + Teams)",
    description:
      "One Microsoft sign-in covers both Outlook email/calendar and Teams messages tied to a deal.",
    scopes: ["offline_access", "User.Read", "Mail.Read", "Calendars.Read", "Chat.Read"],
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientIdEnv: "MICROSOFT_INTEGRATION_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_INTEGRATION_CLIENT_SECRET",
  },
  slack: {
    key: "slack",
    name: "Slack",
    description:
      "Read the channels you point Anchor at for deal-related context, and post updates back.",
    scopes: ["channels:history", "chat:write", "users:read"],
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    clientIdEnv: "SLACK_INTEGRATION_CLIENT_ID",
    clientSecretEnv: "SLACK_INTEGRATION_CLIENT_SECRET",
  },
  salesforce: {
    key: "salesforce",
    name: "Salesforce",
    description:
      "Pull your Salesforce contacts and opportunities into Anchor, enriched with meeting intelligence.",
    // "refresh_token" is Salesforce's actual scope name for getting a
    // refresh token back (there's no separate "offline_access" scope like
    // Google/Microsoft use) — "api" for REST/SOQL access, "openid"+"email"
    // so /services/oauth2/userinfo can identify who connected it.
    scopes: ["api", "refresh_token", "openid", "email"],
    // login.salesforce.com covers both production orgs and free Developer
    // Edition orgs. A sandbox org needs test.salesforce.com instead — not
    // handled here yet; flag it if that's what you're connecting.
    authorizeUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token",
    clientIdEnv: "SALESFORCE_INTEGRATION_CLIENT_ID",
    clientSecretEnv: "SALESFORCE_INTEGRATION_CLIENT_SECRET",
  },
  hubspot: {
    key: "hubspot",
    name: "HubSpot",
    description:
      "Pull your HubSpot contacts and deals into Anchor, enriched with meeting intelligence — same idea as Salesforce, for teams that run HubSpot instead.",
    // HubSpot's newer, more granular scope names for read-only CRM access.
    // "oauth" is required on every HubSpot app to get a refresh token back.
    scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.deals.read"],
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    // Unlike Salesforce/Google/Microsoft, HubSpot uses this SAME endpoint
    // for both the initial code exchange and later refresh-token calls
    // (see refreshAccessToken in hubspot.ts) — one token URL covers both.
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    clientIdEnv: "HUBSPOT_INTEGRATION_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_INTEGRATION_CLIENT_SECRET",
  },
};

export function isProviderConfigured(key: ProviderKey): boolean {
  const cfg = PROVIDERS[key];
  return Boolean(process.env[cfg.clientIdEnv] && process.env[cfg.clientSecretEnv]);
}

export function isProviderKey(value: string): value is ProviderKey {
  return value in PROVIDERS;
}
