import { getGoogleConnection } from "@/lib/integrations/google";
import { fetchRelevantDriveDocuments, hasDriveAccess } from "@/lib/integrations/drive";
import { fetchRelevantDropboxDocuments, getDropboxConnection } from "@/lib/integrations/dropbox";
import { formatDocumentContext, MAX_SEARCH_TERMS, type DocumentContextItem } from "@/lib/integrations/documentSearch";
import { randomUUID } from "crypto";
import type { ServerTool } from "@/lib/liveAssist";
import { buildModelWorkbook, type ModelSpec } from "@/lib/spreadsheetModel";
import { saveExport } from "@/lib/storage";

// Live lookups Ask Anchor can run mid-answer for the person asking (see
// ServerTool in liveAssist.ts), plus the system prompt lines that tell it
// what's connected. Shared by every Ask Anchor surface: the workspace and
// meeting panel (/api/ask) and a deal's panel (/api/deals/[id]/assist).

// Fewer, longer excerpts than the background deal-context refresh: the
// person is asking about something specific (a forecast, a contract), so
// the numbers deep in that one file matter more than a skim of many.
const SEARCH_MAX_DOCUMENTS = 4;
const SEARCH_EXCERPT_CHARS = 6_000;

const WHEN_TO_SEARCH =
  "Use it whenever they ask about a document, deck, spreadsheet, forecast, model, proposal, contract or notes, or about a number or fact that could live in a file — before answering from memory or saying you can't find it. Files are rarely named the way people ask for them, so pass several short queries at once: the key terms on their own, synonyms (forecast, projection, plan, budget, model), short forms (2027 and FY27, Q3, P&L), the company or deal name on its own, and a likely folder name. Matching folders' files are searched too, and results are ranked across all the queries. If nothing fits, search again with different words before giving up.";

function fileSearchTool(params: {
  name: string;
  source: DocumentContextItem["source"];
  searches: string;
  fetch: (queries: string[], opts: { maxDocuments: number; excerptChars: number }) => Promise<DocumentContextItem[]>;
}): ServerTool {
  return {
    tool: {
      name: params.name,
      description: `Search the person's connected ${params.source} ${params.searches}, and read the best matches (most recently edited first). ${WHEN_TO_SEARCH}`,
      input_schema: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: MAX_SEARCH_TERMS,
            description: 'Different short ways to find the file, e.g. ["2027 forecast", "FY27", "projection", "Oro"].',
          },
        },
        required: ["queries"],
      },
    },
    async run(input) {
      // A single "query" string is accepted too, in case the model sends one.
      const raw = Array.isArray(input.queries) ? input.queries : [input.query];
      const queries = raw.filter((q): q is string => typeof q === "string" && q.trim() !== "").map((q) => q.trim());
      if (queries.length === 0) return "No query given.";
      const docs = await params.fetch(queries, { maxDocuments: SEARCH_MAX_DOCUMENTS, excerptChars: SEARCH_EXCERPT_CHARS });
      return (
        formatDocumentContext(docs) ??
        `No files in ${params.source} matched any of: ${queries.map((q) => `"${q}"`).join(", ")}.`
      );
    },
  };
}

// How Ask Anchor builds a model: the way an investment banker would —
// the deal's own facts first, then market data, then labelled assumptions,
// every input in one place with its source, everything else formulas.
export const MODEL_RULES = `When the person asks for a model, forecast, projection, budget, valuation, pricing or ROI analysis, comparison table, or anything "in Excel" or "as a spreadsheet", build it with create_spreadsheet — never paste a large table into the chat instead. Work like an investment banker building a client model:
1. Facts first: gather the real numbers from this deal's calls, emails and files before anything else (the context below, and search_drive / search_dropbox when they're connected — search for the forecast, budget, pricing, P&L, or the company's name). Use their numbers exactly.
2. Then market data: for anything the material doesn't give (market size, growth rates, comparable companies' multiples, industry margins, prices), search the web and use figures from sources you actually opened.
3. Only then assumptions: where neither has it, make a reasonable, conservative assumption and label it as one.
Lay it out like a banker's model:
- "Assumptions" sheet: every input in one place, one per row: Input | Value | Unit | Source type (Call, Email, File, Market data, Assumption) | Source (the call and date, the file name, or the web page). Inputs are plain numbers.
- "Model" sheet: periods across the top (e.g. 2026, 2027, 2028 or Q1–Q4), line items down the side, units in the labels. Every number here is an Excel formula built from the Assumptions sheet ('Assumptions'!B5) or from rows above it — never a typed-in result — so changing an input updates everything.
- "Summary" sheet: the key outputs (revenue, margin, cash, valuation, payback…) as formulas pointing at the Model, plus a base / upside / downside case when it's a forecast or valuation.
- "Sources" sheet: every source used, with links.
Cell positions are exact: rows[0] is Excel row 1 and column 0 is column A, so check every formula's references against where you put things. Use fmt (currency, percent, number, integer, multiple) on every number. After creating it, reply in a few lines: what the model covers, the 3–5 inputs that drive it and where each came from, what was assumed, and the download link exactly as the tool returned it. Don't quote calculated results you didn't work out yourself; point to the file for those.`;

function spreadsheetTool(userId: string): ServerTool {
  return {
    tool: {
      name: "create_spreadsheet",
      description:
        "Create an Excel (.xlsx) file for the person — a financial model, forecast, budget, valuation, pricing or ROI analysis, or a comparison table — with real formulas and banker formatting (inputs blue, formulas black). Returns a download link to give them. Follow the modeling rules in the system prompt.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "File title, e.g. \"Akoya Hospitality — 3-year revenue model\"." },
          summary: { type: "string", description: "2-4 sentences for the cover sheet: what it models and the main assumptions." },
          sheets: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Sheet tab name (≤31 characters), e.g. Assumptions, Model, Summary, Sources." },
                headerRows: { type: "integer", description: "How many top rows are headers (bold, shaded, frozen). Default 1." },
                columnWidths: { type: "array", items: { type: "number" } },
                rows: {
                  type: "array",
                  description:
                    "The sheet, row by row; rows[0] is Excel row 1, and in each row column 0 is A. A cell is a string, a number, null (empty), or an object {v?: value, f?: \"=Excel formula\", fmt?: \"currency\"|\"currency2\"|\"percent\"|\"number\"|\"integer\"|\"multiple\"|\"date\", input?: true for a hard-coded input, bold?: true, note?: \"cell comment\"}. Percentages as fractions (0.25 = 25%).",
                  items: { type: "array", items: { type: ["string", "number", "boolean", "null", "object"] } },
                },
              },
              required: ["name", "rows"],
            },
          },
        },
        required: ["title", "sheets"],
      },
    },
    async run(input) {
      const spec = input as unknown as ModelSpec;
      if (!spec?.title || !Array.isArray(spec.sheets) || !spec.sheets.length) return "No sheets given — nothing was created.";
      const data = await buildModelWorkbook(spec);
      const fileId = `${randomUUID()}.xlsx`;
      await saveExport(userId, fileId, data);
      const name = spec.title.replace(/[^\w .,()&-]+/g, " ").trim().slice(0, 100) || "Anchor model";
      return `Created "${name}.xlsx" (${spec.sheets.length + 1} sheets including the cover). Give the person this link exactly: [Download ${name}.xlsx](/api/exports/${fileId}?name=${encodeURIComponent(name)})`;
    },
  };
}

export async function loadAskTools(userId: string): Promise<{ serverTools: ServerTool[]; toolRules: string }> {
  const [google, dropbox] = await Promise.all([
    getGoogleConnection(userId).catch(() => null),
    getDropboxConnection(userId).catch(() => null),
  ]);
  const serverTools: ServerTool[] = [spreadsheetTool(userId)];
  const connected: string[] = [];
  const missing: string[] = [];

  if (google && hasDriveAccess(google.scope)) {
    serverTools.push(
      fileSearchTool({
        name: "search_drive",
        source: "Google Drive",
        searches: "by file name and full text",
        fetch: (queries, opts) => fetchRelevantDriveDocuments(userId, queries, opts),
      })
    );
    const account = google.externalAccountEmail ? ` (${google.externalAccountEmail})` : "";
    connected.push(`Google Drive${account}, searched with search_drive`);
  } else {
    missing.push("Google Drive");
  }

  if (dropbox) {
    serverTools.push(
      fileSearchTool({
        name: "search_dropbox",
        source: "Dropbox",
        // Content search depends on the person's Dropbox plan.
        searches: "by file name (and by contents on Dropbox plans that index them)",
        fetch: (queries, opts) => fetchRelevantDropboxDocuments(userId, queries, opts),
      })
    );
    const account = dropbox.externalAccountEmail ? ` (${dropbox.externalAccountEmail})` : "";
    connected.push(`Dropbox${account}, searched with search_dropbox`);
  } else {
    missing.push("Dropbox");
  }

  const rules: string[] = [MODEL_RULES];
  if (connected.length) {
    rules.push(
      `Connected file storage: ${connected.join("; ")}. Search it whenever the question could be answered by a file${
        connected.length > 1 ? " (search both when you don't know where the file is)" : ""
      }, and answer from what you find, naming the file and linking it. Never tell the person you can't access their files, and never ask them to paste or describe a file's contents before searching for it. If a couple of different searches find nothing, say what you searched for and ask what the file is called.`
    );
  }
  if (missing.length) {
    rules.push(
      `${missing.join(" and ")} ${missing.length > 1 ? "aren't" : "isn't"} connected for this person, so you can't search ${
        missing.length > 1 ? "them" : "it"
      }. If they ask about a file there, tell them to connect it on the Integrations page.`
    );
  }
  return { serverTools, toolRules: `\n\n${rules.join("\n\n")}` };
}
