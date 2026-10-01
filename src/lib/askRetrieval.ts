// Finds the passages in a deal's own material (call transcripts, the full
// text of attached documents, email digests) that best match a question,
// so Ask Anchor answers from what was actually said or written before it
// reaches for the web. Plain keyword scoring: no index or embeddings to
// keep in sync, and fast enough over a deal's worth of text. Kept free of
// database imports so scripts/test-next-steps.ts can run it.

export type Source = { label: string; kind: "call" | "document" | "email" | "note"; text: string };
export type Passage = { label: string; kind: Source["kind"]; text: string; score: number };

const STOPWORDS = new Set(
  (
    "a about above after again against all am an and any are as at be because been before being below between both but by can " +
    "could did do does doing down during each few for from further had has have having he her here hers herself him himself his " +
    "how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours " +
    "ourselves out over own same she should so some such than that the their theirs them themselves then there these they this " +
    "those through to too under until up very was we were what when where which while who whom why will with would you your " +
    "yours yourself yourselves tell said say says anchor deal call calls meeting meetings please give know think anything " +
    "something thing things get got want wants need needs let lets also any much many us one"
  ).split(" ")
);

// Lowercased words worth matching, with simple suffix stripping so
// "pricing"/"priced"/"prices" all meet at "pric".
export function keywords(text: string): string[] {
  const words = text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/[\s-]+/);
  const out = new Set<string>();
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    out.add(stem(w));
  }
  return [...out];
}

function stem(w: string): string {
  for (const suffix of ["ings", "ing", "ies", "ied", "es", "ed", "ly", "s"]) {
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
  }
  return w;
}

// Overlapping windows on sentence/line boundaries, about `size` chars each.
export function chunk(text: string, size = 700): string[] {
  const pieces = text.split(/(?<=[.!?])\s+|\n+/).filter((p) => p.trim());
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const piece of pieces) {
    current.push(piece);
    length += piece.length + 1;
    if (length >= size) {
      chunks.push(current.join(" "));
      // Keep the last piece so a point split across windows isn't lost.
      current = current.slice(-1);
      length = current[0].length;
    }
  }
  if (current.length && (chunks.length === 0 || current.join(" ") !== chunks[chunks.length - 1])) {
    chunks.push(current.join(" "));
  }
  return chunks;
}

export function findRelevantPassages(
  question: string,
  sources: Source[],
  opts: { maxPassages?: number; maxChars?: number } = {}
): Passage[] {
  const maxPassages = opts.maxPassages ?? 8;
  const maxChars = opts.maxChars ?? 6000;
  const terms = keywords(question);
  if (terms.length === 0) return [];

  const scored: Passage[] = [];
  for (const source of sources) {
    for (const text of chunk(source.text)) {
      const words = keywords(text);
      const set = new Set(words);
      let hits = 0;
      for (const t of terms) {
        if (set.has(t) || words.some((w) => w.length >= 5 && (w.startsWith(t) || t.startsWith(w)))) hits++;
      }
      if (hits === 0) continue;
      // Matching more of the question's distinct words matters most; a
      // short passage dense with them beats a long one that mentions one.
      const score = hits / terms.length + (hits >= 2 ? 0.25 : 0) + Math.min(hits / Math.max(words.length, 1), 0.2);
      scored.push({ label: source.label, kind: source.kind, text, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const picked: Passage[] = [];
  let total = 0;
  for (const p of scored) {
    if (picked.length >= maxPassages) break;
    if (picked.some((q) => q.label === p.label && overlap(q.text, p.text))) continue;
    if (total + p.text.length > maxChars) continue;
    picked.push(p);
    total += p.text.length;
  }
  return picked;
}

function overlap(a: string, b: string): boolean {
  const head = b.slice(0, 80);
  return a.includes(head) || b.includes(a.slice(0, 80));
}

export function formatPassages(passages: Passage[]): string {
  return passages.map((p) => `[${p.label}]\n${p.text}`).join("\n\n");
}
