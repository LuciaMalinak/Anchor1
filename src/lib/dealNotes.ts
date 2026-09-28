import { sql, SQL } from "drizzle-orm";
import { deals } from "@/db/schema";

// Shared by every "Give Anchor more context" entry point that appends to
// deals.notes (typed notes and voice notes — see DealContextBox.tsx and
// its two src/app/api/deals/[id]/context/* routes). Always an addition,
// never an edit: notes are a running, dated log rather than one block of
// text someone can silently rewrite or delete from. The only way to
// change what Anchor "knows" is to add something new — a correction
// typed/recorded here, brought up in a call (which updates the deal's
// rolling memory — see summarize.ts), or a corrected file upload.
//
// This only formats ONE entry's text — it deliberately does NOT read or
// combine with the existing notes column itself. That used to happen
// here (read deal.notes, append in JS, then UPDATE with the whole
// string) which is a read-modify-write race: a typed note and a voice
// note saved moments apart (or two teammates saving at once) could both
// read the same starting deal.notes, both compute their own "existing +
// my entry," and whichever UPDATE lands second would silently overwrite
// the first entry with no error and no trace it ever existed. Both call
// sites now do the append INSIDE the UPDATE's SQL itself (see
// appendDealNoteSql below), which reads the column's live value at write
// time instead of a stale snapshot from earlier in the request.
export function formatDealNoteEntry(label: string, text: string): string {
  const dateLabel = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `[${label} — ${dateLabel}]\n${text}`;
}

// The atomic half of the fix above: a SQL expression for deals.notes'
// SET clause that appends `entry` to whatever the column's value
// actually is AT THE MOMENT THE UPDATE RUNS (computed by Postgres itself,
// as part of one statement) rather than to a value read earlier in the
// request. Two concurrent appends to the same deal now both survive,
// whichever order they commit in, instead of one silently clobbering the
// other.
export function appendDealNoteSql(entry: string): SQL {
  return sql`CASE WHEN ${deals.notes} IS NULL OR ${deals.notes} = '' THEN ${entry} ELSE ${deals.notes} || ${"\n\n"} || ${entry} END`;
}
