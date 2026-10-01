// Read-only Google Drive lookup: finds documents matching a term (by name
// or full text) and reads their text — for a deal's company in
// dealIntegrationContext.ts, and for whatever Ask Anchor searches for
// (its search_drive tool in liveAssist.ts).
// Uses the existing Google connection, and only once the person has
// granted Drive access from the "Google Drive" card on the Integrations
// page (GOOGLE_EXTRA_SCOPES.drive_read). Never writes to Drive.
import path from "path";
import { extractTextFromFile } from "@/lib/extractText";
import { GOOGLE_EXTRA_SCOPES } from "./config";
import { getGoogleConnection, googleGet, googleGetBytes } from "./google";
import { MAX_DOCUMENTS, MAX_DOWNLOAD_BYTES, trimExcerpt, type DocumentContextItem } from "./documentSearch";

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
};

// Google's own formats can't be downloaded as-is; export them as text.
const EXPORT_AS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};

// extractTextFromFile picks its parser from the file extension; supply one
// when a Drive file's name doesn't have it.
const EXTENSION_FOR: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/markdown": ".md",
};

export function hasDriveAccess(scope: string | null | undefined): boolean {
  return (scope ?? "").split(/\s+/).includes(GOOGLE_EXTRA_SCOPES.drive_read);
}

function quoteForDriveQuery(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function fetchRelevantDriveDocuments(
  userId: string,
  term: string,
  opts: { maxDocuments?: number; excerptChars?: number } = {}
): Promise<DocumentContextItem[]> {
  const { maxDocuments = MAX_DOCUMENTS, excerptChars } = opts;
  const connection = await getGoogleConnection(userId);
  if (!connection || !hasDriveAccess(connection.scope) || !term.trim()) return [];

  // By name too, not just full text: a spreadsheet called "2027 Forecast"
  // is the obvious match for "2027 forecast" even when its cells don't
  // contain those words.
  const quoted = quoteForDriveQuery(term.trim());
  const q = `(name contains '${quoted}' or fullText contains '${quoted}') and trashed = false`;
  const listUrl =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&pageSize=${maxDocuments * 2}&fields=${encodeURIComponent("files(id,name,mimeType,modifiedTime,webViewLink,size)")}`;

  let accessToken = connection.accessToken;
  const { json, accessToken: afterList } = await googleGet(connection, accessToken, listUrl);
  accessToken = afterList;

  // Drive can't sort a full-text search, so take the most recently edited.
  const files = (Array.isArray(json.files) ? (json.files as DriveFile[]) : [])
    .filter((f) => f.id && f.name && f.mimeType !== "application/vnd.google-apps.folder")
    .sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""))
    .slice(0, maxDocuments);

  const items: DocumentContextItem[] = [];
  for (const f of files) {
    try {
      const mime = f.mimeType ?? "";
      let text: string | null = null;
      if (EXPORT_AS[mime]) {
        const url = `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=${encodeURIComponent(EXPORT_AS[mime])}`;
        const { data, accessToken: next } = await googleGetBytes(connection, accessToken, url);
        accessToken = next;
        text = data.toString("utf-8");
      } else if (Number(f.size ?? 0) <= MAX_DOWNLOAD_BYTES) {
        const name = path.extname(f.name!) ? f.name! : `${f.name}${EXTENSION_FOR[mime] ?? ""}`;
        if (!path.extname(name)) continue; // a format there's no way to read
        const url = `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`;
        const { data, accessToken: next } = await googleGetBytes(connection, accessToken, url);
        accessToken = next;
        text = await extractTextFromFile(name, data);
      }
      if (!text?.trim()) continue;
      items.push({
        source: "Google Drive",
        name: f.name!,
        modified: f.modifiedTime ?? "",
        link: f.webViewLink ?? null,
        excerpt: trimExcerpt(text, excerptChars),
      });
    } catch (err) {
      // One unreadable file shouldn't drop the rest.
      console.error(`[drive] couldn't read ${f.name}:`, err);
    }
  }
  return items;
}
