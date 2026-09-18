// Shared plumbing for Gmail and Calendar (gmail.ts, calendar.ts) — both
// sit behind the same Google OAuth connection (one "google" row in
// integration_connection, covering both scopes at once — see
// src/lib/integrations/config.ts), so the token lookup and refresh logic
// only needs to exist once. Same shape as salesforce.ts's connection
// handling, just generalized to any Google API endpoint.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";

type Connection = typeof integrationConnections.$inferSelect;

export async function getGoogleConnection(userId: string): Promise<Connection | null> {
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, "google")))
    .limit(1);
  return connection ?? null;
}

async function refreshGoogleAccessToken(connection: Connection): Promise<string> {
  const clientId = process.env.GOOGLE_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_INTEGRATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google isn't configured (missing client credentials).");
  }
  if (!connection.refreshToken) {
    throw new Error("This Google connection has no refresh token — reconnect it.");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.access_token !== "string") {
    console.error("Google token refresh failed:", body);
    throw new Error("Couldn't refresh the Google connection — try reconnecting it.");
  }
  await db
    .update(integrationConnections)
    .set({ accessToken: body.access_token, updatedAt: new Date() })
    .where(eq(integrationConnections.id, connection.id));
  return body.access_token;
}

// GETs a Google API URL, transparently refreshing the access token and
// retrying once if Google reports it as expired (401) — same
// refresh-and-retry-once shape as soqlQuery in salesforce.ts.
export async function googleGet(
  connection: Connection,
  accessToken: string,
  url: string
): Promise<{ json: Record<string, unknown>; accessToken: string }> {
  let token = accessToken;
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = await refreshGoogleAccessToken(connection);
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Google API request failed (${res.status}): ${bodyText.slice(0, 300)}`);
  }
  const json = await res.json();
  return { json, accessToken: token };
}
