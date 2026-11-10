import PptxGenJS from "pptxgenjs";

// Builds the PowerPoint decks Ask Anchor makes when someone asks for a
// presentation, pitch or deck (the create_presentation tool in
// askTools.ts). The AI writes each slide's content; this lays it out the
// way a banker's deck looks: an action title that states the point, one
// message per slide, real charts and tables, a source line at the bottom
// of every slide, and slide numbers.

export type DeckSlide = {
  // title: cover-style · section: divider · bullets · two_column ·
  // metrics: 2-4 big numbers · table · chart
  // agenda: numbered list · timeline: dated steps with owners ·
  // comparison: 2-4 option cards (one can be recommended) · quote
  layout:
    | "title"
    | "section"
    | "bullets"
    | "two_column"
    | "metrics"
    | "table"
    | "chart"
    | "agenda"
    | "timeline"
    | "comparison"
    | "quote";
  title: string;
  subtitle?: string;
  bullets?: string[];
  left?: { heading?: string; bullets: string[] };
  right?: { heading?: string; bullets: string[] };
  metrics?: { value: string; label: string }[];
  table?: string[][];
  chart?: {
    type: "bar" | "line" | "pie" | "stacked_bar";
    categories: string[];
    series: { name: string; values: number[] }[];
    valueFormat?: "currency" | "percent" | "number";
  };
  steps?: { when: string; what: string; owner?: string }[];
  options?: { name: string; bullets: string[]; recommended?: boolean }[];
  quote?: { text: string; by?: string };
  // The "so what" of the slide, shown in a bar at the bottom.
  takeaway?: string;
  // Where the slide's numbers came from, shown at the bottom.
  source?: string;
  notes?: string;
};

export type DeckSpec = {
  title: string;
  subtitle?: string;
  slides: DeckSlide[];
  // Optional brand colours (hex, e.g. "1B365D"), such as the client's.
  theme?: { primary?: string; accent?: string };
};

let NAVY = "0F1E3D";
let ACCENT = "C2410C";
const DEFAULT_NAVY = "0F1E3D";
const DEFAULT_ACCENT = "C2410C";
const SOFT = "F3F4F6";
const hex = (v: string | undefined, fallback: string) =>
  v && /^#?[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().replace(/^#/, "").toUpperCase() : fallback;
const INK = "1F2937";
const MUTED = "6B7280";
const LINE = "D1D5DB";
const CHART_COLORS = ["0F1E3D", "C2410C", "4B6A9B", "9CA3AF", "D97706", "15803D"];
const FONT = "Calibri";
const MAX_SLIDES = 30;

function addFrame(pptx: PptxGenJS, s: PptxGenJS.Slide, title: string, source: string | undefined, n: number) {
  s.background = { color: "FFFFFF" };
  s.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.9, fontFace: FONT, fontSize: 24, bold: true, color: NAVY, valign: "top", fit: "shrink" });
  s.addShape(pptx.ShapeType.line, { x: 0.5, y: 1.2, w: 12.3, h: 0, line: { color: ACCENT, width: 1.5 } });
  s.addShape(pptx.ShapeType.line, { x: 0.5, y: 6.95, w: 12.3, h: 0, line: { color: LINE, width: 0.75 } });
  s.addText(source ? `Source: ${source}` : "", { x: 0.5, y: 7.0, w: 10.5, h: 0.35, fontFace: FONT, fontSize: 9, color: MUTED, fit: "shrink" });
  s.addText(`Anchor.AI  |  ${n}`, { x: 11.0, y: 7.0, w: 1.8, h: 0.35, fontFace: FONT, fontSize: 9, color: MUTED, align: "right" });
}

// One run per bullet (any **markdown bold** markers are dropped: mixing
// runs inside a bullet paragraph makes pptxgenjs write conflicting
// paragraph settings).
function bulletRuns(items: string[]): PptxGenJS.TextProps[] {
  return items.slice(0, 8).map((t) => ({
    text: String(t).replace(/\*\*/g, ""),
    options: { bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 8 },
  }));
}

const isNumeric = (v: string) => /^[-+(]?[$€£]?\s?[\d.,]+\s?(%|x|[kmb]n?|mm)?\)?$/i.test(v.trim());

// One decimal place when the numbers need it (15.4 shouldn't show as 15).
function numberFormat(f?: string, values: number[] = []) {
  const decimals = values.some((v) => {
    const shown = f === "percent" ? v * 100 : v;
    return Math.abs(shown) < 1000 && !Number.isInteger(Math.round(shown * 10) / 10);
  });
  if (f === "currency") return decimals ? '"$"#,##0.0' : '"$"#,##0';
  if (f === "percent") return decimals ? "0.0%" : "0%";
  return decimals ? "#,##0.0" : "#,##0";
}

export async function buildDeck(spec: DeckSpec): Promise<Buffer> {
  NAVY = hex(spec.theme?.primary, DEFAULT_NAVY);
  ACCENT = hex(spec.theme?.accent, DEFAULT_ACCENT);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.title = spec.title;
  pptx.company = "Anchor.AI";

  // Cover
  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addText(spec.title, { x: 0.8, y: 2.4, w: 11.7, h: 1.4, fontFace: FONT, fontSize: 36, bold: true, color: "FFFFFF", fit: "shrink" });
  if (spec.subtitle) cover.addText(spec.subtitle, { x: 0.8, y: 3.8, w: 11.7, h: 0.8, fontFace: FONT, fontSize: 18, color: "D6DEEB" });
  cover.addShape(pptx.ShapeType.line, { x: 0.8, y: 4.75, w: 2.2, h: 0, line: { color: ACCENT, width: 3 } });
  cover.addText(`Prepared by Anchor.AI · ${new Date().toISOString().slice(0, 10)}`, { x: 0.8, y: 6.6, w: 8, h: 0.4, fontFace: FONT, fontSize: 11, color: "D6DEEB" });

  let n = 2;
  for (const d of spec.slides.slice(0, MAX_SLIDES)) {
    const s = pptx.addSlide();
    if (d.notes) s.addNotes(d.notes);

    if (d.layout === "title" || d.layout === "section") {
      s.background = { color: d.layout === "title" ? NAVY : "F3F4F6" };
      const color = d.layout === "title" ? "FFFFFF" : NAVY;
      s.addText(d.title, { x: 0.8, y: 2.6, w: 11.7, h: 1.2, fontFace: FONT, fontSize: 30, bold: true, color, fit: "shrink" });
      if (d.subtitle) s.addText(d.subtitle, { x: 0.8, y: 3.8, w: 11.7, h: 0.8, fontFace: FONT, fontSize: 16, color: d.layout === "title" ? "D6DEEB" : MUTED });
      s.addText(String(n), { x: 11.8, y: 7.0, w: 1, h: 0.35, fontFace: FONT, fontSize: 9, color: MUTED, align: "right" });
      n++;
      continue;
    }

    addFrame(pptx, s, d.title, d.source, n++);
    const body = { x: 0.5, y: 1.45, w: 12.3, h: 5.3 };

    if (d.subtitle) {
      s.addText(d.subtitle, { x: body.x, y: body.y, w: body.w, h: 0.5, fontFace: FONT, fontSize: 14, color: MUTED, italic: true });
      body.y += 0.55;
      body.h -= 0.55;
    }
    if (d.takeaway) body.h -= 0.7;

    if (d.layout === "bullets") {
      s.addText(bulletRuns(d.bullets ?? []), { ...body, fontFace: FONT, fontSize: 18, color: INK, valign: "top", fit: "shrink" });
    } else if (d.layout === "two_column") {
      const col = (c: DeckSlide["left"], x: number) => {
        if (!c) return;
        let y = body.y;
        if (c.heading) {
          s.addText(c.heading, { x, y, w: 5.9, h: 0.5, fontFace: FONT, fontSize: 16, bold: true, color: ACCENT });
          y += 0.6;
        }
        s.addText(bulletRuns(c.bullets ?? []), { x, y, w: 5.9, h: body.h - (y - body.y), fontFace: FONT, fontSize: 16, color: INK, valign: "top", fit: "shrink" });
      };
      col(d.left, 0.5);
      col(d.right, 6.9);
    } else if (d.layout === "metrics") {
      const items = (d.metrics ?? []).slice(0, 4);
      const w = body.w / Math.max(items.length, 1);
      items.forEach((m, i) => {
        const x = body.x + i * w;
        s.addShape(pptx.ShapeType.rect, { x: x + 0.12, y: body.y + 0.6, w: w - 0.24, h: 2.9, fill: { color: SOFT }, line: { color: SOFT } });
        s.addShape(pptx.ShapeType.rect, { x: x + 0.12, y: body.y + 0.6, w: w - 0.24, h: 0.08, fill: { color: ACCENT }, line: { color: ACCENT } });
        s.addText(m.value, { x: x + 0.2, y: body.y + 1.0, w: w - 0.4, h: 1.3, fontFace: FONT, fontSize: 40, bold: true, color: NAVY, align: "center", fit: "shrink" });
        s.addText(m.label, { x: x + 0.2, y: body.y + 2.35, w: w - 0.4, h: 1.0, fontFace: FONT, fontSize: 14, color: MUTED, align: "center", valign: "top" });
      });
      if (d.bullets?.length) {
        s.addText(bulletRuns(d.bullets), { x: body.x, y: body.y + 3.6, w: body.w, h: 1.6, fontFace: FONT, fontSize: 14, color: INK, valign: "top", fit: "shrink" });
      }
    } else if (d.layout === "table" && d.table?.length) {
      const rows = d.table.slice(0, 14).map((r, ri) =>
        r.slice(0, 8).map((cell, ci) => {
          const text = String(cell ?? "");
          return {
            text,
            options:
              ri === 0
                ? { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: ci === 0 ? ("left" as const) : ("center" as const) }
                : {
                    color: INK,
                    bold: ci === 0,
                    fill: { color: ri % 2 === 0 ? "F9FAFB" : "FFFFFF" },
                    align: ci > 0 && isNumeric(text) ? ("right" as const) : ("left" as const),
                  },
          };
        })
      );
      s.addTable(rows, { x: body.x, y: body.y, w: body.w, fontFace: FONT, fontSize: 12, border: { type: "solid", pt: 0.5, color: LINE }, autoPage: false });
    } else if (d.layout === "chart" && d.chart?.series?.length) {
      const c = d.chart;
      const data = c.series.slice(0, 6).map((sr) => ({ name: sr.name, labels: c.categories, values: sr.values }));
      const type = c.type === "line" ? pptx.ChartType.line : c.type === "pie" ? pptx.ChartType.pie : pptx.ChartType.bar;
      s.addChart(type, data, {
        x: body.x,
        y: body.y,
        w: d.bullets?.length ? 8.2 : body.w,
        h: body.h,
        barGrouping: c.type === "stacked_bar" ? "stacked" : "clustered",
        // One series: every bar the same colour (several colours would
        // look like different things).
        chartColors: c.series.length === 1 && c.type !== "pie" ? [NAVY] : CHART_COLORS,
        // Bars start at zero so growth isn't exaggerated.
        ...(c.type === "line" || c.type === "pie" ? {} : { valAxisMinVal: 0 }),
        showLegend: c.series.length > 1 || c.type === "pie",
        legendPos: "b",
        showValue: c.type !== "line",
        dataLabelFormatCode: numberFormat(c.valueFormat, c.series.flatMap((sr) => sr.values)),
        valAxisLabelFormatCode: numberFormat(c.valueFormat),
        catAxisLabelFontFace: FONT,
        valAxisLabelFontFace: FONT,
        dataLabelFontFace: FONT,
        valGridLine: { color: "E5E7EB", size: 0.5 },
      });
      if (d.bullets?.length) {
        s.addText(bulletRuns(d.bullets), { x: 8.9, y: body.y, w: 3.9, h: body.h, fontFace: FONT, fontSize: 14, color: INK, valign: "top", fit: "shrink" });
      }
    } else if (d.layout === "agenda") {
      const items = (d.bullets ?? []).slice(0, 7);
      const rowH = Math.min(0.75, body.h / Math.max(items.length, 1));
      items.forEach((item, i) => {
        const y = body.y + 0.1 + i * rowH;
        s.addShape(pptx.ShapeType.ellipse, { x: body.x + 0.2, y: y + 0.08, w: 0.45, h: 0.45, fill: { color: i === 0 ? ACCENT : NAVY }, line: { color: i === 0 ? ACCENT : NAVY } });
        s.addText(String(i + 1), { x: body.x + 0.2, y: y + 0.08, w: 0.45, h: 0.45, fontFace: FONT, fontSize: 14, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
        s.addText(item.replace(/\*\*/g, ""), { x: body.x + 0.9, y, w: body.w - 1.0, h: 0.6, fontFace: FONT, fontSize: 20, color: INK, valign: "middle", fit: "shrink" });
      });
    } else if (d.layout === "timeline" && d.steps?.length) {
      const steps = d.steps.slice(0, 6);
      const w = body.w / steps.length;
      const lineY = body.y + 1.2;
      s.addShape(pptx.ShapeType.line, { x: body.x + w / 2, y: lineY, w: body.w - w, h: 0, line: { color: LINE, width: 2 } });
      steps.forEach((st, i) => {
        const x = body.x + i * w;
        s.addText(st.when, { x, y: body.y + 0.2, w, h: 0.6, fontFace: FONT, fontSize: 14, bold: true, color: ACCENT, align: "center", fit: "shrink" });
        s.addShape(pptx.ShapeType.ellipse, { x: x + w / 2 - 0.15, y: lineY - 0.15, w: 0.3, h: 0.3, fill: { color: NAVY }, line: { color: "FFFFFF", width: 2 } });
        s.addText(st.what, { x: x + 0.1, y: lineY + 0.35, w: w - 0.2, h: 1.9, fontFace: FONT, fontSize: 14, color: INK, align: "center", valign: "top", fit: "shrink" });
        if (st.owner) s.addText(st.owner, { x: x + 0.1, y: lineY + 2.3, w: w - 0.2, h: 0.45, fontFace: FONT, fontSize: 12, italic: true, color: MUTED, align: "center" });
      });
      if (d.bullets?.length) {
        s.addText(bulletRuns(d.bullets), { x: body.x, y: lineY + 2.9, w: body.w, h: body.h - (lineY + 2.9 - body.y), fontFace: FONT, fontSize: 14, color: INK, valign: "top", fit: "shrink" });
      }
    } else if (d.layout === "comparison" && d.options?.length) {
      const opts = d.options.slice(0, 4);
      const gap = 0.25;
      const w = (body.w - gap * (opts.length - 1)) / opts.length;
      opts.forEach((o, i) => {
        const x = body.x + i * (w + gap);
        const rec = o.recommended === true;
        s.addShape(pptx.ShapeType.rect, { x, y: body.y, w, h: body.h - 0.1, fill: { color: rec ? "FFF7ED" : SOFT }, line: { color: rec ? ACCENT : SOFT, width: rec ? 2 : 0.5 } });
        s.addShape(pptx.ShapeType.rect, { x, y: body.y, w, h: 0.7, fill: { color: rec ? ACCENT : NAVY }, line: { color: rec ? ACCENT : NAVY } });
        s.addText(`${o.name}${rec ? "  ★ Recommended" : ""}`, { x: x + 0.15, y: body.y, w: w - 0.3, h: 0.7, fontFace: FONT, fontSize: 15, bold: true, color: "FFFFFF", valign: "middle", fit: "shrink" });
        s.addText(bulletRuns(o.bullets ?? []), { x: x + 0.15, y: body.y + 0.85, w: w - 0.3, h: body.h - 1.05, fontFace: FONT, fontSize: 13, color: INK, valign: "top", fit: "shrink" });
      });
    } else if (d.layout === "quote" && d.quote?.text) {
      s.addText("\u201C", { x: body.x + 0.3, y: body.y + 0.1, w: 1, h: 1.2, fontFace: "Georgia", fontSize: 96, color: ACCENT });
      s.addText(d.quote.text, { x: body.x + 1.2, y: body.y + 0.6, w: body.w - 2.4, h: 2.8, fontFace: "Georgia", fontSize: 24, italic: true, color: NAVY, valign: "middle", fit: "shrink" });
      if (d.quote.by) s.addText(`— ${d.quote.by}`, { x: body.x + 1.2, y: body.y + 3.5, w: body.w - 2.4, h: 0.5, fontFace: FONT, fontSize: 14, color: MUTED });
    } else if (d.bullets?.length) {
      s.addText(bulletRuns(d.bullets), { ...body, fontFace: FONT, fontSize: 18, color: INK, valign: "top", fit: "shrink" });
    }

    // The "so what", in a bar above the source line.
    if (d.takeaway) {
      s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 6.3, w: 12.3, h: 0.55, fill: { color: NAVY }, line: { color: NAVY } });
      s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 6.3, w: 0.1, h: 0.55, fill: { color: ACCENT }, line: { color: ACCENT } });
      s.addText(d.takeaway.replace(/\*\*/g, ""), { x: 0.75, y: 6.3, w: 12.0, h: 0.55, fontFace: FONT, fontSize: 14, bold: true, color: "FFFFFF", valign: "middle", fit: "shrink" });
    }
  }

  // Sources appendix: every slide's source in one place, unless the deck
  // already ends with its own.
  const sourced = spec.slides.slice(0, MAX_SLIDES).filter((d) => d.source?.trim());
  const hasOwn = spec.slides.some((d) => /^sources?\b/i.test(d.title.trim()));
  if (sourced.length && !hasOwn) {
    const s = pptx.addSlide();
    addFrame(pptx, s, "Sources", undefined, n++);
    const lines = sourced.slice(0, 14).map((d) => `${d.title.slice(0, 70)}${d.title.length > 70 ? "…" : ""}: ${d.source}`);
    s.addText(bulletRuns(lines), { x: 0.5, y: 1.45, w: 12.3, h: 5.3, fontFace: FONT, fontSize: 12, color: INK, valign: "top", fit: "shrink" });
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(out as ArrayBuffer);
}
