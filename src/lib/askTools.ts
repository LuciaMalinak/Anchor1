import { getGoogleConnection } from "@/lib/integrations/google";
import { fetchRelevantDriveDocuments, hasDriveAccess } from "@/lib/integrations/drive";
import { fetchRelevantDropboxDocuments, getDropboxConnection } from "@/lib/integrations/dropbox";
import { formatDocumentContext, MAX_SEARCH_TERMS, type DocumentContextItem } from "@/lib/integrations/documentSearch";
import { randomUUID } from "crypto";
import type { ServerTool } from "@/lib/liveAssist";
import { buildCheckedWorkbook, type ModelCell, type ModelSpec } from "@/lib/spreadsheetModel";
import type { CheckResult } from "@/lib/modelCheck";
import { buildDeck, type DeckSpec } from "@/lib/presentationDeck";
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
Cell positions are exact: rows[0] is Excel row 1 and column 0 is column A, so check every formula's references against where you put things. Sheet names in formulas must match the sheet names you create (quote names with spaces: 'Hotel P&L'!C5). Use fmt (currency, percent, number, integer, multiple) on every number, and put a short label with its unit in column A of every row.

Standard structures to follow (adapt to what was asked):
- Hotel or resort valuation: rooms, occupancy, ADR → RevPAR (= occupancy × ADR) and rooms revenue (= rooms × 365 × occupancy × ADR); F&B and other revenue as a share of rooms revenue or per occupied room; departmental costs, undistributed costs (admin, sales & marketing, property operations, utilities) → GOP and GOP margin; management fees (base % of revenue, incentive % of GOP), FF&E reserve (typically 3–4% of revenue), fixed charges (property tax, insurance) → EBITDA / NOI. Value = stabilised NOI ÷ cap rate, cross-checked with a 10-year DCF (NOI less capex, exit value = year-11 NOI ÷ terminal cap rate, less selling costs), discounted at the discount rate; show value per key. Ramp-up years for a new opening.
- Company valuation / DCF: revenue drivers → EBITDA → EBIT → taxes → unlevered free cash flow (+ D&A − capex − change in working capital); WACC or a stated discount rate; terminal value by exit multiple and/or perpetuity growth; enterprise value → equity value (− net debt); implied multiples.
- Investment returns: sources and uses, debt (amount, rate, amortisation via PMT), cash flows to equity, IRR (=IRR or =XIRR), equity multiple (MOIC), payback, cash-on-cash.
- Every forecast or valuation: a Summary sheet with the headline answer, plus a sensitivity grid built from formulas (e.g. value across 3–5 cap rates × 3–5 NOI or ADR levels; IRR across exit cap rate × hold period) — each grid cell its own formula using that row's and column's input.
- Units: show money in whole dollars (fmt currency), rates as fractions with fmt percent, multiples with fmt multiple.

After create_spreadsheet, read its check. If it lists problems, fix every one with fix_spreadsheet before replying (change only the cells involved) — never hand the person a model with errors. Then reply in a few lines: what the model covers, the headline results quoted from the tool's "Key outputs" (never your own arithmetic), the 3–5 inputs that drive it and where each came from, what was assumed, and the download link exactly as the tool returned it. When the person asks to change an input or add something small to a model you just made, use fix_spreadsheet on it rather than building a new file.`;

// Decks the same way: the deal's facts, then market data, then labelled
// assumptions — written the way a banker builds a client deck.
export const DECK_RULES = `When the person asks for a presentation, deck, slides, pitch, PowerPoint or board/client update, build it with create_presentation. Source the content exactly as for a model: this deal's own calls, emails and files first (search_drive / search_dropbox when connected), then market data from web pages you actually opened, then clearly labelled assumptions. Write it like an investment banker's client deck:
- Every slide title is the takeaway as a full sentence ("Akoya can reach $1.2M ARR by 2028 with 3 hotels"), not a topic label ("Revenue").
- One message per slide; 3-5 short bullets at most, each with a specific fact or number.
- Usual flow: cover, agenda (for 8+ slides), executive summary (the answer up front, often a metrics slide), the situation / what we heard from the client (a quote slide with their own words from a call works well), the numbers (chart or table), options (a comparison slide, with the recommended one marked), risks, next steps (a timeline slide with dates and owners). A Sources slide is added automatically from each slide's source.
- Use a chart slide for any series of numbers, a metrics slide for 2-4 headline figures, a table for detailed comparisons, a comparison slide for options. Give most content slides a takeaway: the "so what" in one line.
- Lead each bullet with its key fact or number. Use the client's brand colours (theme) only when the person asks for them.
- When the deck presents a model you built, use the numbers from create_spreadsheet's Key outputs, never your own arithmetic.
- Put each slide's sources in its source field (call and date, file name, website). Mark assumptions as assumptions.
Afterwards reply in a few lines: what the deck covers, its main message, what was assumed, and the download link exactly as the tool returned it.`;

function presentationTool(userId: string): ServerTool {
  return {
    tool: {
      name: "create_presentation",
      description:
        "Create a PowerPoint (.pptx) deck for the person — a client or board presentation, pitch, deal review or update — with action titles, charts, tables and sources on every slide. Returns a download link to give them. Follow the deck rules in the system prompt.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Deck title for the cover." },
          subtitle: { type: "string", description: "Cover subtitle, e.g. the client and date." },
          theme: {
            type: "object",
            description: "Optional brand colours as 6-digit hex, e.g. the client's or the person's company colours when they ask for them.",
            properties: { primary: { type: "string" }, accent: { type: "string" } },
          },
          slides: {
            type: "array",
            minItems: 1,
            maxItems: 30,
            items: {
              type: "object",
              properties: {
                layout: {
                  type: "string",
                  enum: ["title", "section", "agenda", "bullets", "two_column", "metrics", "table", "chart", "timeline", "comparison", "quote"],
                },
                title: { type: "string", description: "The takeaway as a sentence." },
                subtitle: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
                left: { type: "object", properties: { heading: { type: "string" }, bullets: { type: "array", items: { type: "string" } } } },
                right: { type: "object", properties: { heading: { type: "string" }, bullets: { type: "array", items: { type: "string" } } } },
                metrics: {
                  type: "array",
                  items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" } }, required: ["value", "label"] },
                },
                table: { type: "array", description: "Rows of cells; the first row is the header.", items: { type: "array", items: { type: "string" } } },
                chart: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["bar", "line", "pie", "stacked_bar"] },
                    categories: { type: "array", items: { type: "string" } },
                    series: {
                      type: "array",
                      items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] },
                    },
                    valueFormat: { type: "string", enum: ["currency", "percent", "number"] },
                  },
                  required: ["type", "categories", "series"],
                },
                steps: {
                  type: "array",
                  description: "timeline layout: 3-6 dated steps.",
                  items: { type: "object", properties: { when: { type: "string" }, what: { type: "string" }, owner: { type: "string" } }, required: ["when", "what"] },
                },
                options: {
                  type: "array",
                  description: "comparison layout: 2-4 options side by side; mark the one you recommend.",
                  items: {
                    type: "object",
                    properties: { name: { type: "string" }, bullets: { type: "array", items: { type: "string" } }, recommended: { type: "boolean" } },
                    required: ["name", "bullets"],
                  },
                },
                quote: { type: "object", description: "quote layout: a client's own words from a call.", properties: { text: { type: "string" }, by: { type: "string" } }, required: ["text"] },
                takeaway: { type: "string", description: "The slide's 'so what' in one line, shown in a bar at the bottom." },
                source: { type: "string", description: "Where this slide's facts came from." },
                notes: { type: "string", description: "Speaker notes." },
              },
              required: ["layout", "title"],
            },
          },
        },
        required: ["title", "slides"],
      },
    },
    async run(input) {
      const spec = input as unknown as DeckSpec;
      if (!spec?.title || !Array.isArray(spec.slides) || !spec.slides.length) return "No slides given — nothing was created.";
      if (spec.slides.some((x) => !x || typeof x.title !== "string" || typeof x.layout !== "string")) {
        return "Every slide needs a layout and a title — nothing was created. Send the whole deck again.";
      }
      const data = await buildDeck(spec);
      const fileId = `${randomUUID()}.pptx`;
      await saveExport(userId, fileId, data);
      const name = spec.title.replace(/[^\w .,()&-]+/g, " ").trim().slice(0, 100) || "Anchor.AI deck";
      return `Created "${name}.pptx" (${spec.slides.length + 1} slides including the cover). Give the person this link exactly: [Download ${name}.pptx](/api/exports/${fileId}?name=${encodeURIComponent(name)})`;
    },
  };
}

// Workbooks made in this answer, so fix_spreadsheet can patch one and save
// it again under the same link instead of rebuilding it from scratch.
// Kept in memory for an hour: fixes happen within the same answer.
const recentWorkbooks = new Map<string, { userId: string; spec: ModelSpec; name: string; at: number }>();
function rememberWorkbook(fileId: string, userId: string, spec: ModelSpec, name: string) {
  const now = Date.now();
  for (const [id, w] of recentWorkbooks) if (now - w.at > 60 * 60_000) recentWorkbooks.delete(id);
  recentWorkbooks.set(fileId, { userId, spec, name, at: now });
}

// What the tool tells the model after saving: the link, whether every
// formula calculated, and the key outputs to quote.
function workbookReport(fileId: string, name: string, sheetCount: number, check: CheckResult): string {
  const link = `[Download ${name}.xlsx](/api/exports/${fileId}?name=${encodeURIComponent(name)})`;
  const lines = [`Saved "${name}.xlsx" (${sheetCount + 1} sheets including the cover; file id ${fileId}).`];
  if (check.problems.length) {
    lines.push(
      `Checked all ${check.formulas} formulas: ${check.problems.length} problem(s) to fix before you reply. Fix them with fix_spreadsheet (file id ${fileId}), changing only the cells involved:`,
      ...check.problems.map((p) => `- ${p}`)
    );
  } else {
    lines.push(`Checked all ${check.formulas} formulas: every one calculates.`);
  }
  if (check.keyOutputs.length) {
    lines.push("Key outputs, as calculated (quote these, never your own arithmetic):", ...check.keyOutputs.map((k) => `- ${k}`));
  }
  lines.push(`Give the person this link exactly: ${link}`);
  return lines.join("\n");
}

function fixSpreadsheetTool(userId: string): ServerTool {
  return {
    tool: {
      name: "fix_spreadsheet",
      description:
        "Correct cells in an Excel model you just made with create_spreadsheet — for the problems its check reported, or a change the person asks for — and save it again under the same link. Only send the cells that change. Returns the new check and key outputs.",
      input_schema: {
        type: "object",
        properties: {
          file_id: { type: "string", description: "The file id create_spreadsheet returned, e.g. 1b2c….xlsx" },
          changes: {
            type: "array",
            minItems: 1,
            maxItems: 200,
            items: {
              type: "object",
              properties: {
                sheet: { type: "string", description: "Sheet name exactly as created." },
                cell: { type: "string", description: "A1-style address, e.g. C7." },
                value: { type: ["string", "number", "boolean", "null"], description: "A plain value (null clears the cell)." },
                formula: { type: "string", description: "An Excel formula starting with =" },
                fmt: { type: "string", enum: ["currency", "currency2", "percent", "number", "integer", "multiple", "date"] },
                input: { type: "boolean" },
                bold: { type: "boolean" },
              },
              required: ["sheet", "cell"],
            },
          },
        },
        required: ["file_id", "changes"],
      },
    },
    async run(input) {
      const fileId = typeof input.file_id === "string" ? input.file_id.trim() : "";
      const saved = recentWorkbooks.get(fileId);
      if (!saved || saved.userId !== userId) return "That file isn't one you made in this conversation, so it can't be patched. Create it again with create_spreadsheet.";
      const changes = Array.isArray(input.changes) ? (input.changes as Record<string, unknown>[]) : [];
      const spec: ModelSpec = structuredClone(saved.spec);
      const skipped: string[] = [];
      for (const ch of changes) {
        const sheet = spec.sheets.find((x) => x.name.toLowerCase() === String(ch.sheet ?? "").toLowerCase());
        const m = /^([A-Z]{1,3})(\d{1,5})$/i.exec(String(ch.cell ?? "").trim());
        if (!sheet || !m) {
          skipped.push(`${ch.sheet}!${ch.cell}`);
          continue;
        }
        const col = m[1].toUpperCase().split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
        const row = Number(m[2]) - 1;
        while (sheet.rows.length <= row) sheet.rows.push([]);
        const line = sheet.rows[row] ?? (sheet.rows[row] = []);
        while (line.length <= col) line.push(null);
        const before = line[col];
        const base = before && typeof before === "object" ? { ...before } : before === null || before === undefined ? {} : { v: before };
        const next: Exclude<ModelCell, string | number | boolean | null> = { ...base };
        if (typeof ch.formula === "string" && ch.formula.trim()) {
          next.f = ch.formula.trim().startsWith("=") ? ch.formula.trim() : `=${ch.formula.trim()}`;
          delete next.v;
        } else if ("value" in ch) {
          delete next.f;
          next.v = ch.value as string | number | boolean | null;
        }
        if (typeof ch.fmt === "string") next.fmt = ch.fmt;
        if (typeof ch.input === "boolean") next.input = ch.input;
        if (typeof ch.bold === "boolean") next.bold = ch.bold;
        line[col] = next.f === undefined && (next.v === null || next.v === undefined) ? null : next;
      }
      const { data, check } = await buildCheckedWorkbook(spec);
      await saveExport(userId, fileId, data);
      rememberWorkbook(fileId, userId, spec, saved.name);
      return (skipped.length ? `Skipped (sheet or cell not found): ${skipped.join(", ")}\n` : "") + workbookReport(fileId, saved.name, spec.sheets.length, check);
    },
  };
}

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
      const bad = spec.sheets.filter((x) => !x || typeof x.name !== "string" || !Array.isArray(x.rows));
      if (bad.length) return "Every sheet needs a name and rows — nothing was created. Send the whole workbook again.";
      const { data, check } = await buildCheckedWorkbook(spec);
      const fileId = `${randomUUID()}.xlsx`;
      await saveExport(userId, fileId, data);
      const name = spec.title.replace(/[^\w .,()&-]+/g, " ").trim().slice(0, 100) || "Anchor.AI model";
      rememberWorkbook(fileId, userId, spec, name);
      return workbookReport(fileId, name, spec.sheets.length, check);
    },
  };
}

export async function loadAskTools(userId: string): Promise<{ serverTools: ServerTool[]; toolRules: string }> {
  const [google, dropbox] = await Promise.all([
    getGoogleConnection(userId).catch(() => null),
    getDropboxConnection(userId).catch(() => null),
  ]);
  const serverTools: ServerTool[] = [spreadsheetTool(userId), fixSpreadsheetTool(userId), presentationTool(userId)];
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

  const rules: string[] = [MODEL_RULES, DECK_RULES];
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
