// Read-only Dropbox lookup for a deal: finds files that mention the deal's
// company and reads their text, for dealIntegrationContext.ts. Uses the
// "dropbox" row in integration_connection (see PROVIDERS.dropbox in
// config.ts). Never writes to Dropbox.
import path from "path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { extractTextFromFile } from "@/lib/extractText";
import { PROVIDERS } from "./config";
import { MAX_DOCUMENTS, MAX_DOWNLOAD_BYTES, trimExcerpt, type DocumentContextItem } from "./documentSearch";

type Connection = typeof integrationConnections.$inferSelect;

type DropboxFile = {
  ".tag"?: string;
  id?: string;
  name?: string;
  path_lower?: string;
  path_display?: string;
  server_modified?: string;
  size?: number;
};

async function getDropboxConnection(userId: string): Promise<Connection | null> {
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, "dropbox")))
    .limit(1);
  return connection ?? null;
}

// Dropbox access tokens expire after a few hours; the refresh token from
// the offline connect (token_access_type=offline) gets a new one.
async function refreshDropboxAccessToken(connection: Connection): Promise<string> {
  const clientId = process.env.DROPBOX_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.DROPBOX_INTEGRATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Dropbox isn't configured (missing client credentials).");
  if (!connection.refreshToken) throw new Error("This Dropbox connection has no refresh token — reconnect it.");
  const res = await fetch(PROVIDERS.dropbox.tokenUrl, {
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
    console.error("Dropbox token refresh failed:", body);
    throw new Error("Couldn't refresh the Dropbox connection — try reconnecting it.");
  }
  await db
    .update(integrationConnections)
    .set({
      accessToken: body.access_token,
      tokenExpiresAt: typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnections.id, connection.id));
  return body.access_token;
}

// Sends a Dropbox API request, refreshing the token and retrying once on 401.
async function dropboxFetch(
  connection: Connection,
  token: string,
  url: string,
  init: { body?: string; headers?: Record<string, string> }
): Promise<{ res: Response; token: string }> {
  const send = (t: string) =>
    fetch(url, { method: "POST", headers: { Authorization: `Bearer ${t}`, ...(init.headers ?? {}) }, body: init.body });
  let res = await send(token);
  if (res.status === 401) {
    token = await refreshDropboxAccessToken(connection);
    res = await send(token);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dropbox API request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return { res, token };
}

export async function fetchRelevantDropboxDocuments(userId: string, term: string): Promise<DocumentContextItem[]> {
  const connection = await getDropboxConnection(userId);
  if (!connection || !term.trim()) return [];

  let token = connection.accessToken;
  const search = await dropboxFetch(connection, token, "https://api.dropboxapi.com/2/files/search_v2", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: term, options: { max_results: MAX_DOCUMENTS * 2, file_status: "active" } }),
  });
  token = search.token;
  const body = (await search.res.json()) as { matches?: { metadata?: { metadata?: DropboxFile } }[] };

  const files = (body.matches ?? [])
    .map((m) => m.metadata?.metadata)
    .filter((f): f is DropboxFile => Boolean(f && f[".tag"] === "file" && f.path_lower && f.name))
    .sort((a, b) => (b.server_modified ?? "").localeCompare(a.server_modified ?? ""))
    .slice(0, MAX_DOCUMENTS);

  const items: DocumentContextItem[] = [];
  for (const f of files) {
    try {
      if (!path.extname(f.name!) || (f.size ?? 0) > MAX_DOWNLOAD_BYTES) continue;
      const download = await dropboxFetch(connection, token, "https://content.dropboxapi.com/2/files/download", {
        // Dropbox takes the file path as JSON in this header; escape
        // non-ASCII as Dropbox requires for header values.
        headers: {
          "Dropbox-API-Arg": JSON.stringify({ path: f.path_lower }).replace(
            /[\u007f-￿]/g,
            (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
          ),
        },
      });
      token = download.token;
      const text = await extractTextFromFile(f.name!, Buffer.from(await download.res.arrayBuffer()));
      if (!text?.trim()) continue;
      items.push({
        source: "Dropbox",
        name: f.name!,
        modified: f.server_modified ?? "",
        // Opens the file's folder on dropbox.com with the file previewed.
        link: f.path_display
          ? `https://www.dropbox.com/home${encodeURI(path.posix.dirname(f.path_display)).replace(/\/$/, "")}?preview=${encodeURIComponent(f.name!)}`
          : null,
        excerpt: trimExcerpt(text),
      });
    } catch (err) {
      console.error(`[dropbox] couldn't read ${f.name}:`, err);
    }
  }
  return items;
}
