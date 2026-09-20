// Shared by every "Give Anchor more context" entry point that appends to
// deals.notes (typed notes and voice notes — see DealContextBox.tsx and
// its two src/app/api/deals/[id]/context/* routes). Always an addition,
// never an edit: notes are a running, dated log rather than one block of
// text someone can silently rewrite or delete from. The only way to
// change what Anchor "knows" is to add something new — a correction
// typed/recorded here, brought up in a call (which updates the deal's
// rolling memory — see summarize.ts), or a corrected file upload.
export function appendDealNoteEntry(
  existingNotes: string | null,
  label: string,
  text: string
): string {
  const dateLabel = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const entry = `[${label} — ${dateLabel}]\n${text}`;
  return existingNotes ? `${existingNotes}\n\n${entry}` : entry;
}
