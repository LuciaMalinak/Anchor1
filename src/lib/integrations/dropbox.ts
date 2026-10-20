// Read-only Dropbox lookup for a deal: finds files that mention the deal's
// company and reads their text, for dealIntegrationContext.ts. Uses the
// "dropbox" row in integration_connection (see PROVIDERS.dropbox in
// config.ts). Never writes to Dropbox.
import path from "path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { extractTextFromFile } from "@/lib/extractText";
import { DROPBOX_EXTRA_SCOPES, PROVIDERS, hasScopes } from "./config";
import {
  MAX_DOCUMENTS,
  MAX_DOWNLOAD_BYTES,
  MAX_SEARCH_TERMS,
  rankCandidates,
  searchWords,
  trimExcerpt,
  type DocumentContextItem,
  type SearchCandidate,
} from "./documentSearch";

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

export async function getDropboxConnection(userId: string): Promise<Connection | null> {
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

// Matching folders whose files are also considered, and files per folder.
const MAX_FOLDERS = 3;
const MAX_FOLDER_FILES = 50;

// Finds and reads the files most likely meant by the search terms: each
// term is searched (Dropbox matches file names, and contents too on plans
// that index them), files inside matching folders count too (a deal's
// folder holds its files whatever they're called), and the best-ranked
// are read. One term is enough; Ask Anchor sends several wordings.
export async function fetchRelevantDropboxDocuments(
  userId: string,
  terms: string | string[],
  opts: { maxDocuments?: number; excerptChars?: number } = {}
): Promise<DocumentContextItem[]> {
  const { maxDocuments = MAX_DOCUMENTS, excerptChars } = opts;
  const queries = [...new Set((Array.isArray(terms) ? terms : [terms]).map((t) => t.trim()).filter(Boolean))].slice(
    0,
    MAX_SEARCH_TERMS
  );
  const connection = await getDropboxConnection(userId);
  if (!connection || queries.length === 0) return [];

  let token = connection.accessToken;
  const call = async <T>(url: string, body: unknown): Promise<T> => {
    const result = await dropboxFetch(connection, token, url, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    token = result.token;
    return (await result.res.json()) as T;
  };
  const search = (query: string) =>
    call<{ matches?: { metadata?: { metadata?: DropboxFile } }[] }>("https://api.dropboxapi.com/2/files/search_v2", {
      query,
      options: { max_results: 20, file_status: "active" },
    }).then((body) => (body.matches ?? []).map((m) => m.metadata?.metadata).filter((f): f is DropboxFile => Boolean(f)));

  const candidates = new Map<string, SearchCandidate<DropboxFile>>();
  const folders = new Map<string, number>();
  const addFile = (f: DropboxFile) => {
    if (f[".tag"] !== "file" || !f.path_lower || !f.name) return;
    const existing = candidates.get(f.path_lower);
    if (existing) existing.hits++;
    else candidates.set(f.path_lower, { file: f, hits: 1, haystack: f.path_lower, modified: f.server_modified ?? "" });
  };

  // The first search alone, so an expired token is refreshed once; the
  // rest together, since someone is waiting on the answer.
  const results = [await search(queries[0]), ...(await Promise.all(queries.slice(1).map(search)))];
  for (const f of results.flat()) {
    if (f[".tag"] === "folder" && f.path_lower) folders.set(f.path_lower, (folders.get(f.path_lower) ?? 0) + 1);
    else addFile(f);
  }
  const topFolders = [...folders.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_FOLDERS);
  const folderFiles = await Promise.all(
    topFolders.map(([folder]) =>
      call<{ entries?: DropboxFile[] }>("https://api.dropboxapi.com/2/files/list_folder", {
        path: folder,
        recursive: false,
        limit: MAX_FOLDER_FILES,
      })
        .then((body) => body.entries ?? [])
        .catch((err) => {
          console.error(`[dropbox] couldn't list ${folder}:`, err);
          return [];
        })
    )
  );
  folderFiles.flat().forEach(addFile);

  // Twice as many as needed, so an unreadable file's place goes to the next best.
  const files = rankCandidates([...candidates.values()], searchWords(queries), maxDocuments * 2);

  const items: DocumentContextItem[] = [];
  for (const f of files) {
    if (items.length >= maxDocuments) break;
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
        excerpt: trimExcerpt(text, excerptChars),
      });
    } catch (err) {
      console.error(`[dropbox] couldn't read ${f.name}:`, err);
    }
  }
  return items;
}

// Thrown when the Dropbox connection is read-only (connected before saving
// recaps existed), so the meeting page can ask for write access.
export class NeedsDropboxPermissionError extends Error {}

// Dropbox wants non-ASCII in its JSON header escaped.
function dropboxArg(arg: unknown): string {
  return JSON.stringify(arg).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

// A file or folder name Dropbox will take: no slashes or characters
// Windows can't sync, no trailing dots or spaces.
export function dropboxSafeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "").slice(0, 200) || "Untitled";
}

// Saves `content` as a new file in `folder` (created if missing). Never
// overwrites: a clash gets " (1)" added by Dropbox. Returns where it went
// and a link that opens the file on dropbox.com.
export async function saveDropboxFile(
  userId: string,
  params: { folder: string; fileName: string; content: string }
): Promise<{ path: string; link: string }> {
  const connection = await getDropboxConnection(userId);
  if (!connection) throw new Error("Dropbox isn't connected yet — connect it from the Integrations page first.");
  if (!hasScopes(connection.scope, DROPBOX_EXTRA_SCOPES.files_write)) {
    throw new NeedsDropboxPermissionError("Anchor needs permission to save files to Dropbox.");
  }
  const folder = "/" + params.folder.split("/").map((p) => p.trim()).filter(Boolean).map(dropboxSafeName).join("/");
  const filePath = `${folder === "/" ? "" : folder}/${dropboxSafeName(params.fileName)}`;
  let saved: DropboxFile;
  try {
    const { res } = await dropboxFetch(connection, connection.accessToken, "https://content.dropboxapi.com/2/files/upload", {
      headers: {
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": dropboxArg({ path: filePath, mode: "add", autorename: true, mute: false }),
      },
      body: params.content,
    });
    saved = (await res.json()) as DropboxFile;
  } catch (err) {
    if (err instanceof Error && err.message.includes("missing_scope")) {
      throw new NeedsDropboxPermissionError("Anchor needs permission to save files to Dropbox.");
    }
    throw err;
  }
  const shown = saved.path_display ?? filePath;
  return {
    path: shown,
    link: `https://www.dropbox.com/home${encodeURI(path.posix.dirname(shown)).replace(/\/$/, "")}?preview=${encodeURIComponent(
      path.posix.basename(shown)
    )}`,
  };
}
