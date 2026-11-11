// Token handling for providers without their own helper file (Microsoft,
// Zoom): load the connection, refresh its access token when it has
// expired, and call the API with refresh-and-retry-once on a 401, the
// same shape as googleGet in google.ts.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { PROVIDERS, type ProviderKey } from "./config";

type Connection = typeof integrationConnections.$inferSelect;

export async function getConnection(userId: string, provider: ProviderKey): Promise<Connection | null> {
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, provider)))
    .limit(1);
  return connection ?? null;
}

// The provider refused to renew the connection (its refresh token was
// revoked, replaced, or the app's settings changed): the person has to
// connect it again. Callers turn this into a one-click Reconnect link.
export class ConnectionExpiredError extends Error {
  constructor(public provider: ProviderKey, name: string) {
    super(`Your ${name} connection has expired, so Anchor.AI needs you to reconnect it (one click).`);
    this.name = "ConnectionExpiredError";
  }
}

// One renewal at a time per connection: Zoom replaces the refresh token on
// every use, so two renewals at once make the second fail and could lose
// the connection. A second caller waits for the first one's result.
const refreshing = new Map<string, Promise<string>>();

async function refresh(connection: Connection): Promise<string> {
  const running = refreshing.get(connection.id);
  if (running) return running;
  const job = refreshOnce(connection).finally(() => refreshing.delete(connection.id));
  refreshing.set(connection.id, job);
  return job;
}

async function refreshOnce(connection: Connection): Promise<string> {
  const cfg = PROVIDERS[connection.provider];
  const clientId = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret) throw new Error(`${cfg.name} isn't configured (missing client credentials).`);
  if (!connection.refreshToken) throw new Error(`This ${cfg.name} connection has no refresh token — reconnect it.`);
  const basic = cfg.tokenAuth === "basic";
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(basic ? { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` } : {}),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
      ...(basic ? {} : { client_id: clientId, client_secret: clientSecret }),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.access_token !== "string") {
    console.error(`${connection.provider} token refresh failed:`, body);
    // Another server (or request) may have renewed it a moment ago with
    // the same refresh token; if the stored one has changed, use that.
    const [latest] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, connection.id));
    if (latest && latest.refreshToken && latest.refreshToken !== connection.refreshToken && latest.accessToken) {
      Object.assign(connection, latest);
      return latest.accessToken;
    }
    throw new ConnectionExpiredError(connection.provider, cfg.name);
  }
  // Zoom (and sometimes Microsoft) rotate the refresh token on every use.
  await db
    .update(integrationConnections)
    .set({
      accessToken: body.access_token,
      ...(typeof body.refresh_token === "string" && body.refresh_token ? { refreshToken: body.refresh_token } : {}),
      tokenExpiresAt: typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnections.id, connection.id));
  connection.accessToken = body.access_token;
  if (typeof body.refresh_token === "string" && body.refresh_token) connection.refreshToken = body.refresh_token;
  return body.access_token;
}

// Calls the API with the connection's token, refreshing it first when it
// has expired (or is about to), and once more if the API says 401.
export async function apiFetch(connection: Connection, url: string, init: RequestInit = {}): Promise<Response> {
  const expiringSoon = connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() < Date.now() + 60_000;
  let token = expiringSoon ? await refresh(connection) : connection.accessToken;
  const send = (t: string) =>
    fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}`, "Content-Type": "application/json" } });
  let res = await send(token);
  if (res.status === 401) {
    token = await refresh(connection);
    res = await send(token);
  }
  return res;
}
