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

    // Images, spreadsheets, .doc (old binary format), pptx, zip, etc. —
    // not handled yet. The file still uploads; it's just not readable by
    // the AI, which the UI and the assist context both say plainly.
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
