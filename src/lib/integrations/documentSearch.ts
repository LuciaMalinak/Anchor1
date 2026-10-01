// Shared by drive.ts and dropbox.ts: what to search a deal's documents
// for, and how found documents are passed on to deal context.

export type DocumentContextItem = {
  source: "Google Drive" | "Dropbox";
  name: string;
  modified: string; // ISO date
  link: string | null;
  excerpt: string; // plain text, already trimmed
};

// Documents fetched per source, and how much of each one's text is kept.
export const MAX_DOCUMENTS = 5;
export const MAX_EXCERPT_CHARS = 1500;
// Skip downloading anything bigger than this; it's unlikely to be a deal
// document worth reading in full, and it would slow the refresh down.
export const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;

// The company part of a deal name: "Northbridge — Series B" -> "Northbridge".
// Falls back to the whole name when there's no separator or the first part
// is too short to be a useful search term.
export function dealSearchTerm(dealName: string): string {
  const first = dealName.split(/\s+[—–-]\s+|:\s+|\s+\|\s+/)[0]?.trim() ?? "";
  return first.length >= 3 ? first : dealName.trim();
}

export function trimExcerpt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_EXCERPT_CHARS ? `${clean.slice(0, MAX_EXCERPT_CHARS)}…` : clean;
}

export function formatDocumentContext(items: DocumentContextItem[]): string | null {
  if (items.length === 0) return null;
  return items
    .map(
      (d) =>
        `— ${d.name} (${d.source}, updated ${d.modified.slice(0, 10)})${d.link ? ` ${d.link}` : ""}\n${d.excerpt}`
    )
    .join("\n\n");
}
