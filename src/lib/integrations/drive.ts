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

const FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_FIELDS = encodeURIComponent("files(id,name,mimeType,modifiedTime,webViewLink,size)");
// Matching folders whose files are also considered, and files per folder.
const MAX_FOLDERS = 3;
const MAX_FOLDER_FILES = 50;

// Finds and reads the files most likely meant by the search terms: each
// term is searched by name and full text, files inside matching folders
// count too (a deal's folder holds its files whatever they're called),
// and the best-ranked are read. One term is enough; Ask Anchor sends
// several wordings.
export async function fetchRelevantDriveDocuments(
  userId: string,
  terms: string | string[],
  opts: { maxDocuments?: number; excerptChars?: number } = {}
): Promise<DocumentContextItem[]> {
  const { maxDocuments = MAX_DOCUMENTS, excerptChars } = opts;
  const queries = [...new Set((Array.isArray(terms) ? terms : [terms]).map((t) => t.trim()).filter(Boolean))].slice(
    0,
    MAX_SEARCH_TERMS
  );
  const connection = await getGoogleConnection(userId);
  if (!connection || !hasDriveAccess(connection.scope) || queries.length === 0) return [];

  let accessToken = connection.accessToken;
  const list = async (q: string, pageSize: number): Promise<DriveFile[]> => {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${pageSize}&fields=${DRIVE_FIELDS}`;
    const { json, accessToken: next } = await googleGet(connection, accessToken, url);
    accessToken = next;
    return Array.isArray(json.files) ? (json.files as DriveFile[]) : [];
  };

  const candidates = new Map<string, SearchCandidate<DriveFile>>();
  const folders = new Map<string, { name: string; hits: number }>();
  const addFile = (f: DriveFile, folderName = "") => {
    if (!f.id || !f.name) return;
    const existing = candidates.get(f.id);
    if (existing) {
      existing.hits++;
      if (folderName) existing.haystack += ` ${folderName.toLowerCase()}`;
      return;
    }
    candidates.set(f.id, {
      file: f,
      hits: 1,
      haystack: `${folderName} ${f.name}`.toLowerCase(),
      modified: f.modifiedTime ?? "",
    });
  };

  // By name too, not just full text: a spreadsheet called "2027 Forecast"
  // is the obvious match for "2027 forecast" even when its cells don't
  // contain those words.
  const search = (term: string) => {
    const quoted = quoteForDriveQuery(term);
    return list(`(name contains '${quoted}' or fullText contains '${quoted}') and trashed = false`, 20);
  };
  // The first search alone, so an expired token is refreshed once; the
  // rest together, since someone is waiting on the answer.
  const results = [await search(queries[0]), ...(await Promise.all(queries.slice(1).map(search)))];
  for (const f of results.flat()) {
    if (f.mimeType === FOLDER_MIME) {
      if (f.id && f.name) folders.set(f.id, { name: f.name, hits: (folders.get(f.id)?.hits ?? 0) + 1 });
    } else {
      addFile(f);
    }
  }
  const topFolders = [...folders.entries()].sort((a, b) => b[1].hits - a[1].hits).slice(0, MAX_FOLDERS);
  const folderFiles = await Promise.all(
    topFolders.map(([id]) => list(`'${quoteForDriveQuery(id)}' in parents and trashed = false`, MAX_FOLDER_FILES))
  );
  topFolders.forEach(([, folder], i) => {
    for (const f of folderFiles[i]) if (f.mimeType !== FOLDER_MIME) addFile(f, folder.name);
  });

  // Twice as many as needed, so an unreadable file's place goes to the next best.
  const files = rankCandidates([...candidates.values()], searchWords(queries), maxDocuments * 2);

  const items: DocumentContextItem[] = [];
  for (const f of files) {
    if (items.length >= maxDocuments) break;
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
