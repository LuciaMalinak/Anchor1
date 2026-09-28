// A short, bounded reference to a deal's attached files, for AI contexts
// that need to at least know they exist without spending the budget full
// excerpts cost — that's what Ask Anchor's /api/deals/[id]/assist route
// already does (it hands liveAssist.ts the full extractedText of every
// file, since that's a single interactive answer). Live coaching, handoff
// briefings, and the rolling deal-memory merge run far more often (a live
// call regenerates coaching every ~8s) or want a tighter prompt, so they
// get a capped digest instead: a handful of files, a short excerpt each.
const MAX_FILES = 5;
const MAX_CHARS_PER_FILE = 500;

export type DealFileRef = { fileName: string; extractedText: string | null };

export function summarizeDealFiles(files: DealFileRef[]): string | null {
  const withText = files.filter((f) => f.extractedText?.trim());
  if (withText.length === 0) return null;

  return withText
    .slice(0, MAX_FILES)
    .map((f) => {
      const text = f.extractedText!.trim();
      const excerpt = text.length > MAX_CHARS_PER_FILE ? `${text.slice(0, MAX_CHARS_PER_FILE)}…` : text;
      return `— ${f.fileName}: ${excerpt}`;
    })
    .join("\n");
}
