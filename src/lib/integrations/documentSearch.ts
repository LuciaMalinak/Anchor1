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

// How many differently-worded searches one lookup may run (Ask Anchor
// sends several: synonyms, abbreviations, the company name, a folder).
export const MAX_SEARCH_TERMS = 6;

const STOP_WORDS = new Set(["the", "and", "for", "our", "my", "with", "from", "file", "doc", "document", "latest", "new"]);

// The words to look for in a file's name and folder path, from every
// search term. Years also match their short forms, since files are often
// named "FY27" or "Plan 27" rather than "2027".
export function searchWords(terms: string[]): string[] {
  const words = new Set<string>();
  for (const term of terms) {
    for (const word of term.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word.length < 2 || STOP_WORDS.has(word)) continue;
      words.add(word);
      const fullYear = word.match(/^20(\d\d)$/);
      const shortYear = word.match(/^fy(\d\d)$/);
      if (fullYear) words.add(`fy${fullYear[1]}`).add(`'${fullYear[1]}`);
      if (shortYear) words.add(`20${shortYear[1]}`);
    }
  }
  return [...words];
}

// A file found by one or more searches. haystack is its name and folder
// path, lower-cased.
export type SearchCandidate<T> = { file: T; hits: number; haystack: string; modified: string };

// Most likely first: found by more of the searches, then sharing more
// words with them by name or folder, then most recently edited.
export function rankCandidates<T>(candidates: SearchCandidate<T>[], words: string[], max: number): T[] {
  const score = (c: SearchCandidate<T>) => c.hits * 3 + words.filter((w) => c.haystack.includes(w)).length;
  return [...candidates]
    .sort((a, b) => score(b) - score(a) || b.modified.localeCompare(a.modified))
    .slice(0, max)
    .map((c) => c.file);
}

export function trimExcerpt(text: string, maxChars: number = MAX_EXCERPT_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}…` : clean;
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
