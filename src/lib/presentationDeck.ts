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
  layout: "title" | "section" | "bullets" | "two_column" | "metrics" | "table" | "chart";
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
  // Where the slide's numbers came from, shown at the bottom.
  source?: string;
  notes?: string;
};

export type DeckSpec = { title: string; subtitle?: string; slides: DeckSlide[] };

const NAVY = "0F1E3D";
const ACCENT = "C2410C";
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
  s.addText(`Anchor  |  ${n}`, { x: 11.0, y: 7.0, w: 1.8, h: 0.35, fontFace: FONT, fontSize: 9, color: MUTED, align: "right" });
}

function bulletRuns(items: string[]): PptxGenJS.TextProps[] {
  return items.slice(0, 8).map((t) => ({
    text: t,
    options: { bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 8 },
  }));
}

function numberFormat(f?: string) {
  return f === "currency" ? '"$"#,##0' : f === "percent" ? "0%" : "#,##0";
}

export async function buildDeck(spec: DeckSpec): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.title = spec.title;
  pptx.company = "Anchor";

  // Cover
  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addText(spec.title, { x: 0.8, y: 2.4, w: 11.7, h: 1.4, fontFace: FONT, fontSize: 36, bold: true, color: "FFFFFF", fit: "shrink" });
  if (spec.subtitle) cover.addText(spec.subtitle, { x: 0.8, y: 3.8, w: 11.7, h: 0.8, fontFace: FONT, fontSize: 18, color: "D6DEEB" });
  cover.addShape(pptx.ShapeType.line, { x: 0.8, y: 4.75, w: 2.2, h: 0, line: { color: ACCENT, width: 3 } });
  cover.addText(`Prepared by Anchor · ${new Date().toISOString().slice(0, 10)}`, { x: 0.8, y: 6.6, w: 8, h: 0.4, fontFace: FONT, fontSize: 11, color: "D6DEEB" });

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
        s.addText(m.value, { x: x + 0.1, y: body.y + 1.0, w: w - 0.2, h: 1.3, fontFace: FONT, fontSize: 40, bold: true, color: NAVY, align: "center", fit: "shrink" });
        s.addText(m.label, { x: x + 0.1, y: body.y + 2.4, w: w - 0.2, h: 1.0, fontFace: FONT, fontSize: 14, color: MUTED, align: "center", valign: "top" });
      });
      if (d.bullets?.length) {
        s.addText(bulletRuns(d.bullets), { x: body.x, y: body.y + 3.6, w: body.w, h: 1.6, fontFace: FONT, fontSize: 14, color: INK, valign: "top", fit: "shrink" });
      }
    } else if (d.layout === "table" && d.table?.length) {
      const rows = d.table.slice(0, 14).map((r, ri) =>
        r.slice(0, 8).map((cell) => ({
          text: String(cell ?? ""),
          options: ri === 0 ? { bold: true, color: "FFFFFF", fill: { color: NAVY } } : { color: INK },
        }))
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
        chartColors: CHART_COLORS,
        showLegend: c.series.length > 1 || c.type === "pie",
        legendPos: "b",
        showValue: c.type !== "line",
        dataLabelFormatCode: numberFormat(c.valueFormat),
        valAxisLabelFormatCode: numberFormat(c.valueFormat),
        catAxisLabelFontFace: FONT,
        valAxisLabelFontFace: FONT,
        dataLabelFontFace: FONT,
        valGridLine: { color: "E5E7EB", size: 0.5 },
      });
      if (d.bullets?.length) {
        s.addText(bulletRuns(d.bullets), { x: 8.9, y: body.y, w: 3.9, h: body.h, fontFace: FONT, fontSize: 14, color: INK, valign: "top", fit: "shrink" });
      }
    } else if (d.bullets?.length) {
      s.addText(bulletRuns(d.bullets), { ...body, fontFace: FONT, fontSize: 18, color: INK, valign: "top", fit: "shrink" });
    }
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(out as ArrayBuffer);
}
