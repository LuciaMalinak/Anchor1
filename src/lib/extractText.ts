import path from "path";
import { pathToFileURL } from "url";

let pdfWorkerConfigured = false;

// pdf-parse (via pdfjs-dist) resolves its worker script relative to its
// own bundled location by default, which breaks under Next.js's bundler
// (Turbopack/webpack move things around at build time, and the relative
// path no longer points anywhere real) — fails with "Setting up fake
// worker failed". Pointing it at the real file's absolute path on disk
// sidesteps the bundler entirely and works the same in dev and in the
// deployed app, since node_modules is present on disk either way (no
// `output: "standalone"` trace-and-prune step in this project).
async function configurePdfWorker() {
  if (pdfWorkerConfigured) return;
  const { PDFParse } = await import("pdf-parse");
  const workerPath = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  PDFParse.setWorker(pathToFileURL(workerPath).href);
  pdfWorkerConfigured = true;
}

// Pulls plain text out of a deal file at upload time so it can be fed to
// the AI (Ask Anchor) as real content, not just a filename — see the
// "Files attached to this deal (names only)" gap this replaces. Never
// throws: an unsupported type or a parse failure just means no text is
// available, and the file still uploads and downloads fine either way.
//
// Capped well under what we'd want to send an LLM per file — this is
// meant to give Anchor the gist of a doc, not a lossless copy.
const MAX_EXTRACTED_CHARS = 12_000;

const PLAIN_TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".log"]);

// Pulls every <t>/<a:t> text-run node's inner text out of a chunk of
// OOXML (the XML format inside .pptx/.xlsx/.docx zip packages). Used
// instead of a real XML parser (no new dependency for it) — safe here
// specifically because we only ever read text OUT of these tags, never
// feed anything back into markup, so there's no injection risk the way
// there would be constructing HTML/XML with this. Strips namespace
// prefixes on both open and self-closing/closing tags for either <t> or
// <a:t> so it matches every style of the tag this format actually uses.
function extractTagText(xml: string, tagLocalName: string): string[] {
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tagLocalName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tagLocalName}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const decoded = m[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    if (decoded.trim()) out.push(decoded);
  }
  return out;
}

// Numeric-sorts the zip entries a JSZip regex filter returns (slide2
// before slide10) — plain string sort would put slide10 right after
// slide1, scrambling reading order.
function sortByTrailingNumber(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const na = Number(a.match(/(\d+)(?=\.xml$)/)?.[1] ?? 0);
    const nb = Number(b.match(/(\d+)(?=\.xml$)/)?.[1] ?? 0);
    return na - nb;
  });
}

async function extractPptxText(data: Buffer): Promise<string | null> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const slideFiles = sortByTrailingNumber(
    Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  );
  const slideTexts: string[] = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name].async("string");
    // <a:t> is the run-text tag PowerPoint uses for every piece of
    // visible text on a slide (title, bullets, text boxes) — not speaker
    // notes, which live in a separate ppt/notesSlides/ part we don't read.
    const runs = extractTagText(xml, "a:t");
    if (runs.length > 0) slideTexts.push(runs.join(" "));
  }
  return truncate(slideTexts.join("\n"));
}

async function extractXlsxText(data: Buffer): Promise<string | null> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);

  // The shared-string table: every distinct piece of text anywhere in
  // the workbook lives here once, and cells reference it by index rather
  // than embedding the text inline — see below.
  const sharedStrings: string[] = [];
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  if (sharedStringsFile) {
    const xml = await sharedStringsFile.async("string");
    // Each <si> entry is one shared string, itself possibly split across
    // several <t> runs (rich text) — join those before moving to the
    // next entry rather than flattening every <t> across the whole file
    // (which would merge separate strings together).
    const entries = xml.match(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>/g) ?? [];
    for (const entry of entries) {
      sharedStrings.push(extractTagText(entry, "t").join(""));
    }
  }

  const sheetFiles = sortByTrailingNumber(
    Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
  );

  const lines: string[] = [];
  for (const name of sheetFiles) {
    const xml = await zip.files[name].async("string");
    const rows = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? [];
    for (const row of rows) {
      const cells = row.match(/<c[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? [];
      const values: string[] = [];
      for (const cell of cells) {
        const typeMatch = cell.match(/\st="([^"]+)"/);
        const type = typeMatch?.[1];
        if (type === "s") {
          const idx = Number(cell.match(/<v>(\d+)<\/v>/)?.[1]);
          if (!Number.isNaN(idx) && sharedStrings[idx]) values.push(sharedStrings[idx]);
        } else if (type === "inlineStr") {
          values.push(extractTagText(cell, "t").join(""));
        } else if (type === "str" || type === "b") {
          const v = cell.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          if (v) values.push(v);
        } else {
          // No `t` attribute means a plain number — still worth keeping
          // (this is exactly where something like a revenue figure
          // would live), just without any label context beyond the row.
          const v = cell.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          if (v) values.push(v);
        }
      }
      if (values.some((v) => v.trim())) lines.push(values.join("\t"));
    }
  }
  return truncate(lines.join("\n"));
}

export async function extractTextFromFile(
  fileName: string,
  data: Buffer
): Promise<string | null> {
  const ext = path.extname(fileName).toLowerCase();

  try {
    if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
      return truncate(data.toString("utf-8"));
    }

    if (ext === ".pdf") {
      // Lazy import: pdf-parse pulls in a fair bit of code we don't want
      // loaded for every request, only when a PDF actually shows up.
      await configurePdfWorker();
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data });
      const result = await parser.getText();
      await parser.destroy();
      return truncate(result.text);
    }

    if (ext === ".docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: data });
      return truncate(result.value);
    }

    if (ext === ".pptx") {
      return await extractPptxText(data);
    }

    if (ext === ".xlsx") {
      return await extractXlsxText(data);
    }

    // Images, old binary .doc/.ppt/.xls, zip, etc. — not handled yet.
    // The file still uploads; it's just not readable by the AI, which
    // the UI and the assist context both say plainly. (Deliberately not
    // using the full "xlsx" npm package for .xlsx above — its current
    // release has known prototype-pollution/ReDoS issues; the hand-rolled
    // reader here only ever reads text out of the zip's XML, never
    // evaluates anything from the file.)
    return null;
  } catch (err) {
    console.error(`Text extraction failed for ${fileName}:`, err);
    return null;
  }
}

function truncate(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_EXTRACTED_CHARS
    ? cleaned.slice(0, MAX_EXTRACTED_CHARS) + "…"
    : cleaned;
}
