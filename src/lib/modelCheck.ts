import FormulaParser from "fast-formula-parser";
import * as formulajs from "@formulajs/formulajs";
import type { ModelCell } from "@/lib/spreadsheetModel";

// Works out every formula in a workbook Ask Anchor is about to save (the
// create_spreadsheet tool), the way Excel would, before anyone opens it:
// - catches broken formulas (#REF!, #DIV/0!, unknown functions, a sheet
//   that doesn't exist, circular references) so the AI can fix them
//   before the person sees the file;
// - gives each formula its calculated result, saved into the file so
//   previews (phone, Google Drive, Quick Look) show numbers rather than
//   blanks (Excel still recalculates everything itself on open);
// - lists the key outputs (the Summary sheet's figures), so the answer can
//   quote the model's real numbers.
// fast-formula-parser does the parsing and most functions; Formula.js
// fills in the ones it lacks (NPV, IRR, XNPV, PMT, MAX, …).

type Cell = { formula?: string; value?: unknown; fmt?: string };
export type CheckSheet = { name: string; rows: ModelCell[][] };
export type CheckResult = {
  formulas: number;
  // Calculated result per "sheet!row,col" (1-based), for formula cells.
  results: Map<string, unknown>;
  problems: string[];
  keyOutputs: string[];
};

const MAX_PROBLEMS = 25;

function colName(col: number): string {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export const cellAddress = (row: number, col: number) => `${colName(col)}${row}`;

// Formula.js versions of the functions fast-formula-parser doesn't have,
// found once by asking the parser for each.
let extraFunctions: Record<string, (...args: unknown[]) => unknown> | null = null;
function functionsFor(): Record<string, (...args: unknown[]) => unknown> {
  if (extraFunctions) return extraFunctions;
  const probe = new FormulaParser({});
  const fns: Record<string, (...args: unknown[]) => unknown> = {};
  for (const [name, fn] of Object.entries(formulajs)) {
    if (typeof fn !== "function" || !/^[A-Z][A-Z0-9.]*$/.test(name)) continue;
    try {
      probe.parse(`${name}()`, { sheet: "S", row: 1, col: 1 });
    } catch (err) {
      if (!/not implemented/i.test(err instanceof Error ? err.message : String(err))) continue;
      fns[name] = (...args: unknown[]) =>
        (fn as (...a: unknown[]) => unknown)(
          ...args.map((a) => (a && typeof a === "object" && "value" in (a as object) ? (a as { value: unknown }).value : a))
        );
    }
  }
  extraFunctions = fns;
  return fns;
}

function errorOf(v: unknown): string | null {
  if (v instanceof Error) return v.message || "#VALUE!";
  if (v && typeof v === "object" && "_error" in (v as object)) return String((v as { _error: unknown })._error);
  if (typeof v === "string" && /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)$/.test(v)) return v;
  if (typeof v === "number" && !Number.isFinite(v)) return "#NUM!";
  return null;
}

function formatValue(v: unknown, fmt?: string): string {
  if (typeof v !== "number") return String(v ?? "");
  switch (fmt) {
    case "percent":
      return `${(v * 100).toFixed(1)}%`;
    case "multiple":
      return `${v.toFixed(1)}x`;
    case "currency":
    case "currency2":
      return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: fmt === "currency2" ? 2 : 0 })}`;
    case "integer":
      return Math.round(v).toLocaleString("en-US");
    default:
      return Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Math.round(v * 1000) / 1000);
  }
}

export function checkWorkbook(sheets: CheckSheet[]): CheckResult {
  const grid = new Map<string, { name: string; cells: Map<string, Cell> }>();
  for (const sheet of sheets) {
    const cells = new Map<string, Cell>();
    sheet.rows.forEach((row, ri) =>
      (row ?? []).forEach((raw, ci) => {
        if (raw === null || raw === undefined || raw === "") return;
        const spec = typeof raw === "object" ? raw : { v: raw };
        const formula =
          typeof spec.f === "string" ? spec.f : typeof spec.v === "string" && spec.v.startsWith("=") ? spec.v : undefined;
        cells.set(`${ri + 1},${ci + 1}`, { formula: formula?.replace(/^=/, ""), value: formula ? undefined : spec.v, fmt: spec.fmt });
      })
    );
    grid.set(sheet.name.toLowerCase(), { name: sheet.name, cells });
  }

  const results = new Map<string, unknown>();
  const problems: string[] = [];
  const problemKeys = new Set<string>();
  const note = (key: string, text: string) => {
    if (problemKeys.has(key) || problems.length >= MAX_PROBLEMS) return;
    problemKeys.add(key);
    problems.push(text);
  };
  const evaluating = new Set<string>();
  let current = "";

  const sheetOf = (name: string) => {
    const s = grid.get(name.toLowerCase());
    if (!s) note(`sheet:${name.toLowerCase()}`, `${current}: refers to a sheet called "${name}", which doesn't exist (sheets: ${[...grid.values()].map((g) => g.name).join(", ")}).`);
    return s;
  };

  const evaluate = (sheetName: string, row: number, col: number): unknown => {
    const sheet = sheetOf(sheetName);
    if (!sheet) return null;
    const cell = sheet.cells.get(`${row},${col}`);
    if (!cell) return null;
    if (cell.formula === undefined) return cell.value ?? null;
    const key = `${sheet.name}!${row},${col}`;
    if (results.has(key)) return results.get(key);
    const at = `${sheet.name}!${cellAddress(row, col)}`;
    if (evaluating.has(key)) {
      note(`circ:${key}`, `${at}: circular reference (=${cell.formula}).`);
      return 0;
    }
    evaluating.add(key);
    const outer = current;
    current = `${at} (=${cell.formula.slice(0, 120)})`;
    let value: unknown;
    try {
      value = parser.parse(cell.formula, { sheet: sheet.name, row, col });
      if (Array.isArray(value)) value = Array.isArray(value[0]) ? value[0][0] : value[0];
    } catch (err) {
      value = { _error: err instanceof Error ? err.message : String(err) };
    }
    const error = errorOf(value);
    if (error) note(`err:${key}`, `${current}: ${error}`);
    current = outer;
    evaluating.delete(key);
    results.set(key, error ? error : value);
    return value;
  };

  const parser = new FormulaParser({
    functions: functionsFor(),
    onCell: ({ sheet, row, col }) => evaluate(sheet, row, col),
    onRange: ({ sheet, from, to }) => {
      const out: unknown[][] = [];
      if (!sheetOf(sheet)) return [[null]];
      for (let r = from.row; r <= Math.min(to.row, from.row + 1000); r++) {
        const line: unknown[] = [];
        for (let c = from.col; c <= Math.min(to.col, from.col + 100); c++) line.push(evaluate(sheet, r, c));
        out.push(line);
      }
      return out;
    },
  });

  let formulas = 0;
  for (const sheet of grid.values()) {
    for (const [pos, cell] of sheet.cells) {
      if (cell.formula === undefined) continue;
      formulas++;
      const [r, c] = pos.split(",").map(Number);
      current = "";
      evaluate(sheet.name, r, c);
    }
  }

  // Key outputs: the summary sheet's labelled figures, with the header
  // row's labels (years, cases) where it has them.
  const summary =
    [...grid.values()].find((s) => /summary|valuation|returns|output|dashboard|scenario/i.test(s.name)) ??
    [...grid.values()].at(-1);
  const keyOutputs: string[] = [];
  if (summary) {
    const header = new Map<number, string>();
    for (const [pos, cell] of summary.cells) {
      const [r, c] = pos.split(",").map(Number);
      if (r === 1 && c > 1 && cell.value !== undefined && cell.value !== null) header.set(c, String(cell.value));
    }
    const rows = new Map<number, { label?: string; values: string[] }>();
    for (const [pos, cell] of [...summary.cells].sort(([a], [b]) => {
      const [ar, ac] = a.split(",").map(Number);
      const [br, bc] = b.split(",").map(Number);
      return ar - br || ac - bc;
    })) {
      const [r, c] = pos.split(",").map(Number);
      const entry = rows.get(r) ?? { values: [] };
      if (c === 1 && typeof cell.value === "string") entry.label = cell.value;
      else if (c > 1 && cell.formula !== undefined) {
        const v = results.get(`${summary.name}!${r},${c}`);
        if (typeof v === "number") entry.values.push(`${header.get(c) ? `${header.get(c)} ` : ""}${formatValue(v, cell.fmt)}`);
      }
      rows.set(r, entry);
    }
    for (const { label, values } of rows.values()) {
      if (label && values.length) keyOutputs.push(`${label}: ${values.slice(0, 6).join(" | ")}`);
      if (keyOutputs.length >= 20) break;
    }
  }

  return { formulas, results, problems, keyOutputs };
}
