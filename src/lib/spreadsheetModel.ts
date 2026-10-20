import ExcelJS from "exceljs";

// Builds the Excel files Ask Anchor makes when someone asks for a model,
// forecast or table (the create_spreadsheet tool in askTools.ts). The AI
// lays out every sheet cell by cell — rows[0] is Excel row 1, column 0 is
// A — with real formulas, and this turns that into a formatted workbook
// the way a banker's model looks: hard-coded inputs in blue, formulas in
// black, units in the headers, frozen header rows, and a cover sheet with
// the legend and where every number came from.

export type ModelCell =
  | string
  | number
  | boolean
  | null
  | {
      // A value, or an Excel formula starting with "=".
      v?: string | number | boolean | null;
      f?: string;
      // currency, percent, number, integer, multiple (2.5x), date, text
      fmt?: string;
      // A hard-coded input (shown in blue) rather than a calculation.
      input?: boolean;
      bold?: boolean;
      note?: string;
    };

export type ModelSheet = {
  name: string;
  rows: ModelCell[][];
  // How many rows at the top are headers (bold, shaded, frozen). Default 1.
  headerRows?: number;
  columnWidths?: number[];
};

export type ModelSpec = {
  title: string;
  summary?: string;
  sheets: ModelSheet[];
};

const FORMATS: Record<string, string> = {
  currency: '"$"#,##0;[Red]-"$"#,##0',
  currency2: '"$"#,##0.00;[Red]-"$"#,##0.00',
  percent: "0.0%",
  number: "#,##0.0",
  integer: "#,##0",
  multiple: '0.0"x"',
  date: "yyyy-mm-dd",
};

const BLUE = "FF1F4FD8";
const HEADER_FILL = "FFE8EEF7";
const MAX_SHEETS = 12;
const MAX_ROWS = 400;
const MAX_COLS = 40;

function sheetName(name: string, used: Set<string>): string {
  let base = (name || "Sheet").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";
  let n = 2;
  let out = base;
  while (used.has(out.toLowerCase())) {
    base = base.slice(0, 28);
    out = `${base} ${n++}`;
  }
  used.add(out.toLowerCase());
  return out;
}

function applyCell(cell: ExcelJS.Cell, raw: ModelCell, isHeader: boolean) {
  const spec = raw !== null && typeof raw === "object" ? raw : { v: raw };
  const formula = typeof spec.f === "string" ? spec.f : typeof spec.v === "string" && spec.v.startsWith("=") ? spec.v : null;
  if (formula) {
    cell.value = { formula: formula.replace(/^=/, "") } as ExcelJS.CellFormulaValue;
  } else if (spec.v !== undefined && spec.v !== null) {
    cell.value = spec.v;
  }
  if (spec.fmt && FORMATS[spec.fmt]) cell.numFmt = FORMATS[spec.fmt];
  // Banker convention: inputs blue, calculations black.
  const isInput = spec.input === true || (!formula && typeof spec.v === "number" && !isHeader && spec.input !== false);
  cell.font = {
    name: "Calibri",
    size: 11,
    bold: isHeader || spec.bold === true,
    color: isInput ? { argb: BLUE } : undefined,
  };
  if (isHeader) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF9AA9C2" } } };
  }
  if (spec.note) cell.note = spec.note;
}

export async function buildModelWorkbook(spec: ModelSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Anchor";
  wb.created = new Date();
  // Formulas are written without results; have Excel work them out on open.
  wb.calcProperties = { fullCalcOnLoad: true };

  const used = new Set<string>();
  const cover = wb.addWorksheet(sheetName("Cover", used));
  cover.getColumn(1).width = 26;
  cover.getColumn(2).width = 90;
  cover.getCell("A1").value = spec.title;
  cover.getCell("A1").font = { size: 16, bold: true };
  cover.getCell("A2").value = `Prepared by Anchor on ${new Date().toISOString().slice(0, 10)}`;
  cover.getCell("A2").font = { italic: true, color: { argb: "FF6B7280" } };
  let r = 4;
  if (spec.summary) {
    cover.getCell(`A${r}`).value = "Summary";
    cover.getCell(`A${r}`).font = { bold: true };
    cover.getCell(`B${r}`).value = spec.summary;
    cover.getCell(`B${r}`).alignment = { wrapText: true, vertical: "top" };
    r += 2;
  }
  cover.getCell(`A${r}`).value = "How to read it";
  cover.getCell(`A${r}`).font = { bold: true };
  const legend: [string, string][] = [
    ["Blue numbers", "Inputs — from your calls, emails and files, from market data, or stated assumptions. Change these."],
    ["Black numbers", "Calculations — formulas that update when the inputs change."],
    ["Sources", "Every input's source is listed next to it on the Assumptions sheet."],
  ];
  for (const [k, v] of legend) {
    cover.getCell(`B${r}`).value = `${k}: ${v}`;
    if (k === "Blue numbers") cover.getCell(`B${r}`).font = { color: { argb: BLUE } };
    r++;
  }

  for (const sheet of spec.sheets.slice(0, MAX_SHEETS)) {
    const ws = wb.addWorksheet(sheetName(sheet.name, used));
    const headerRows = Math.max(0, Math.min(sheet.headerRows ?? 1, 5));
    const rows = (sheet.rows ?? []).slice(0, MAX_ROWS);
    let widest = 0;
    rows.forEach((row, ri) => {
      (row ?? []).slice(0, MAX_COLS).forEach((raw, ci) => {
        widest = Math.max(widest, ci + 1);
        if (raw === null || raw === undefined || raw === "") return;
        applyCell(ws.getCell(ri + 1, ci + 1), raw, ri < headerRows);
      });
    });
    for (let c = 1; c <= widest; c++) {
      const given = sheet.columnWidths?.[c - 1];
      ws.getColumn(c).width = given && given > 3 && given < 80 ? given : c === 1 ? 34 : 14;
    }
    if (headerRows) ws.views = [{ state: "frozen", ySplit: headerRows, xSplit: 1 }];
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
