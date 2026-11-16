import PptxGenJS from "pptxgenjs";
import { colorDistance, hue, luminance, mix } from "@/lib/brandColors";
import { fitPhoto, type DeckLogo, type DeckPhoto } from "@/lib/deckImages";

// Builds the PowerPoint decks Ask Anchor makes when someone asks for a
// presentation, pitch or deck (the create_presentation tool in
// askTools.ts). The AI writes each slide's content; this lays it out the
// way a polished advisory deck looks: an action title that states the
// point, one message per slide, real charts and tables, a source line on
// every slide, and the firm's own brand colours (brandColors.ts) carried
// through the cover, titles, tables and charts.

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
    | "quote"
    | "image"
    | "gallery";
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
  // A photo for the slide: an image link, or "auto" for the next photo
  // found for the deck (company website, Dropbox, Drive). "image" slides
  // are a full-bleed photo; on others it sits beside the content.
  image?: string;
  // gallery layout: 2-4 photos with captions.
  gallery?: { image?: string; caption: string }[];
  // Filled in by assignPhotos before building.
  photo?: DeckPhoto;
  galleryPhotos?: (DeckPhoto | null)[];
  // The "so what" of the slide, shown in a band at the bottom.
  takeaway?: string;
  // Where the slide's numbers came from, shown at the bottom.
  source?: string;
  notes?: string;
};

export type DeckSpec = {
  title: string;
  subtitle?: string;
  // Who the deck is for, shown above the title on the cover.
  client?: string;
  // The firm presenting it, shown on the cover and in every footer.
  preparedBy?: string;
  slides: DeckSlide[];
  // Brand colours (hex, e.g. "1B365D"): primary for the cover, titles and
  // table headers, accent for rules and highlights.
  theme?: { primary?: string; accent?: string };
  // Found by the server (deckImages.ts), not written by the AI: the photo
  // pool, the cover photo and the company logo.
  coverPhoto?: DeckPhoto;
  logo?: DeckLogo | null;
};

// Hands out the photo pool: slides that asked for a photo ("auto") first,
// then the cover, then section dividers and quotes, each photo used once.
export function assignPhotos(spec: DeckSpec, pool: DeckPhoto[], linked: Map<string, DeckPhoto>): DeckSpec {
  const queue = [...pool];
  const next = () => queue.shift();
  const pick = (ref: string | undefined) => (ref && ref !== "auto" ? linked.get(ref) : undefined);
  const slides = spec.slides.map((d) => ({ ...d }));
  for (const d of slides) {
    d.photo = pick(d.image);
    if (d.layout === "gallery") d.galleryPhotos = (d.gallery ?? []).slice(0, 4).map((g) => pick(g.image) ?? null);
  }
  for (const d of slides) {
    if (!d.photo && (d.image === "auto" || d.layout === "image")) d.photo = next();
    if (d.galleryPhotos) d.galleryPhotos = d.galleryPhotos.map((p) => p ?? next() ?? null);
  }
  const coverPhoto = spec.coverPhoto ?? next();
  for (const d of slides) if (!d.photo && !d.image && (d.layout === "section" || d.layout === "quote")) d.photo = next();
  return { ...spec, slides, coverPhoto };
}

const DEFAULT_PRIMARY = "14213D"; // deep navy
const DEFAULT_ACCENT = "B08D57"; // champagne gold
const WHITE = "FFFFFF";
const INK = "1F2937";
const MUTED = "6B7280";
const HAIRLINE = "E5E7EB";
const FONT = "Calibri";
const SERIF = "Georgia";
const MAX_SLIDES = 30;
const W = 13.333;
const MX = 0.65; // side margin
const CW = W - MX * 2; // content width

type Theme = {
  primary: string; // dark: cover, titles, table headers
  accent: string; // rules, highlights, numbers on dark
  soft: string; // light tint of primary for panels
  accentSoft: string; // light tint of accent for the takeaway band
  onPrimaryMuted: string; // secondary text on the primary background
  accentOnDark: string; // the accent, made readable on the primary
  chart: string[];
};

const hex = (v: string | undefined) => (v && /^#?[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().replace(/^#/, "").toUpperCase() : null);

// Brand colours made fit for a deck: the primary dark enough for white
// text on it, the accent visible on white and distinct from the primary.
export function deckTheme(theme?: { primary?: string; accent?: string }): Theme {
  let primary = hex(theme?.primary) ?? DEFAULT_PRIMARY;
  let accent = hex(theme?.accent) ?? null;
  // A bright brand colour (orange, teal…) works as the accent; the deck
  // still needs a dark primary, so it gets a deep shade of the same hue.
  if (luminance(primary) > 0.09) {
    if (!accent) accent = primary;
    const h = hue(primary);
    if (h >= 22 && h <= 75) {
      // Orange and yellow go brown or olive when darkened: charcoal instead.
      primary = "1F2430";
    } else {
      let p = primary;
      for (let i = 0; i < 12 && luminance(p) > 0.06; i++) p = mix(p, "000000", 0.18);
      primary = p;
    }
  }
  if (!accent) accent = DEFAULT_ACCENT;
  if (luminance(accent) > 0.7) accent = mix(accent, "000000", 0.3);
  if (colorDistance(accent, primary) < 70) accent = hex(theme?.primary) && colorDistance(DEFAULT_ACCENT, primary) > 70 ? DEFAULT_ACCENT : mix(primary, WHITE, 0.55);
  return {
    primary,
    accent,
    soft: mix(primary, WHITE, 0.94),
    accentSoft: mix(accent, WHITE, 0.86),
    onPrimaryMuted: mix(primary, WHITE, 0.72),
    accentOnDark: readableOn(accent, primary),
    chart: [primary, accent, mix(primary, WHITE, 0.45), mix(accent, WHITE, 0.45), mix(primary, WHITE, 0.7), "9CA3AF"],
  };
}

// WCAG contrast ratio between two colours.
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// Lightens a colour until it reads on a dark background.
function readableOn(color: string, bg: string): string {
  let c = color;
  for (let i = 0; i < 8 && contrast(c, bg) < 4; i++) c = mix(c, WHITE, 0.25);
  return c;
}

const clean = (t: string) => String(t ?? "").replace(/\*\*/g, "").trim();

// "Revenue up 18%: driven by three new doctors" -> bold lead + rest, so a
// bullet's key fact stands out.
function leadRuns(text: string, t: Theme, size: number): PptxGenJS.TextProps[] {
  const s = clean(text);
  const m = s.match(/^(.{3,70}?)(:\s|\s[–—-]\s)(.+)$/);
  if (!m) return [{ text: s, options: { color: INK, fontSize: size } }];
  return [
    { text: m[1] + m[2].replace(/\s+$/, " "), options: { bold: true, color: t.primary, fontSize: size } },
    { text: m[3], options: { color: INK, fontSize: size } },
  ];
}

// A plain bulleted list (for narrow spaces). One run per bullet: mixing
// runs inside a bullet paragraph makes pptxgenjs write conflicting
// paragraph settings.
function bulletRuns(items: string[]): PptxGenJS.TextProps[] {
  return items.slice(0, 8).map((s) => ({
    text: clean(s),
    options: { bullet: { code: "25A0", indent: 16 }, breakLine: true, paraSpaceAfter: 9, color: INK },
  }));
}

// Bullets as spaced rows, each with an accent marker and its lead phrase
// in bold: far easier to read on a screen than a dense list.
function bulletRows(
  pptx: PptxGenJS,
  s: PptxGenJS.Slide,
  items: string[],
  t: Theme,
  box: { x: number; y: number; w: number; h: number },
  size = 18
) {
  const list = items.map(clean).filter(Boolean).slice(0, 7);
  if (!list.length) return;
  const rowH = Math.min(1.0, box.h / list.length);
  const fontSize = list.length > 5 ? Math.min(size, 15) : list.length > 4 ? Math.min(size, 16) : size;
  list.forEach((item, i) => {
    const y = box.y + i * rowH;
    s.addShape(pptx.ShapeType.rect, { x: box.x, y: y + rowH / 2 - 0.06, w: 0.12, h: 0.12, fill: { color: t.accent }, line: { color: t.accent } });
    s.addText(leadRuns(item, t, fontSize), { x: box.x + 0.3, y, w: box.w - 0.3, h: rowH, fontFace: FONT, valign: "middle", fit: "shrink", margin: 2 });
    if (i < list.length - 1) {
      s.addShape(pptx.ShapeType.line, { x: box.x + 0.3, y: y + rowH, w: box.w - 0.3, h: 0, line: { color: HAIRLINE, width: 0.75 } });
    }
  });
}

type Edges = [PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps];

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

// Large outline rings in the corner of the dark slides.
function rings(pptx: PptxGenJS, s: PptxGenJS.Slide, t: Theme) {
  const none = { color: t.primary, transparency: 100 };
  s.addShape(pptx.ShapeType.ellipse, { x: 8.6, y: -1.6, w: 7.0, h: 7.0, fill: none, line: { color: t.accentOnDark, width: 1.25, transparency: 35 } });
  s.addShape(pptx.ShapeType.ellipse, { x: 9.8, y: 2.4, w: 5.2, h: 5.2, fill: none, line: { color: t.onPrimaryMuted, width: 0.75, transparency: 70 } });
  s.addShape(pptx.ShapeType.ellipse, { x: 10.75, y: 0.55, w: 0.22, h: 0.22, fill: { color: t.accentOnDark }, line: { color: t.accentOnDark } });
}

// A photo filling the right of a dark slide, with an accent edge.
async function photoPanel(pptx: PptxGenJS, s: PptxGenJS.Slide, photo: DeckPhoto, t: Theme) {
  const x = 7.35;
  s.addImage({ data: await fitPhoto(photo, W - x, 7.5), x, y: 0, w: W - x, h: 7.5 });
  s.addShape(pptx.ShapeType.rect, { x: x - 0.06, y: 0, w: 0.06, h: 7.5, fill: { color: t.accent }, line: { color: t.accent } });
}

// The company's logo on a white card, readable on any background.
function logoChip(pptx: PptxGenJS, s: PptxGenJS.Slide, logo: DeckLogo, x: number, y: number) {
  const h = 0.5;
  const w = Math.min(2.6, h * logo.aspect);
  s.addShape(pptx.ShapeType.roundRect, { x, y, w: w + 0.4, h: h + 0.3, fill: { color: WHITE }, line: { color: WHITE }, rectRadius: 0.08 });
  s.addImage({ data: logo.data, x: x + 0.2, y: y + 0.15, w, h });
}

// A full-bleed photo with the title on a dark panel over its left side.
async function imageSlide(pptx: PptxGenJS, s: PptxGenJS.Slide, d: DeckSlide, t: Theme, n: number) {
  s.background = { color: t.primary };
  if (d.photo) s.addImage({ data: await fitPhoto(d.photo, W, 7.5), x: 0, y: 0, w: W, h: 7.5 });
  // A dark panel that fades into the photo in narrow steps.
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 6.3, h: 7.5, fill: { color: t.primary, transparency: 10 }, line: { color: t.primary, transparency: 100 } });
  [25, 40, 55, 70, 85].forEach((tr, i) => {
    s.addShape(pptx.ShapeType.rect, { x: 6.3 + i * 0.22, y: 0, w: 0.22, h: 7.5, fill: { color: t.primary, transparency: tr }, line: { color: t.primary, transparency: 100 } });
  });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: t.accent }, line: { color: t.accent } });
  s.addText(clean(d.title), { x: 0.9, y: 1.6, w: 5.2, h: 2.0, fontFace: SERIF, fontSize: 32, color: WHITE, valign: "bottom", fit: "shrink" });
  s.addShape(pptx.ShapeType.line, { x: 0.9, y: 3.85, w: 1.2, h: 0, line: { color: t.accentOnDark, width: 2.5 } });
  let y = 4.05;
  if (d.subtitle) {
    s.addText(clean(d.subtitle), { x: 0.9, y, w: 5.2, h: 0.8, fontFace: FONT, fontSize: 16, color: t.onPrimaryMuted, valign: "top", fit: "shrink" });
    y += 0.85;
  }
  const items = (d.bullets ?? []).map(clean).filter(Boolean).slice(0, 4);
  items.forEach((b, i) => {
    s.addText(
      [
        { text: "—  ", options: { color: t.accentOnDark, bold: true } },
        { text: b, options: { color: WHITE } },
      ],
      { x: 0.9, y: y + i * 0.5, w: 5.2, h: 0.5, fontFace: FONT, fontSize: 14, valign: "middle", fit: "shrink" }
    );
  });
  if (d.takeaway) s.addText(clean(d.takeaway), { x: 0.9, y: 6.2, w: 5.2, h: 0.55, fontFace: FONT, fontSize: 13, bold: true, color: t.accentOnDark, fit: "shrink" });
  s.addText(d.source ? `Source: ${clean(d.source)}` : "", { x: 0.9, y: 7.0, w: 5.2, h: 0.32, fontFace: FONT, fontSize: 9, color: t.onPrimaryMuted, fit: "shrink" });
  s.addText(String(n), { x: W - MX - 1, y: 7.0, w: 1, h: 0.32, fontFace: FONT, fontSize: 9, color: WHITE, align: "right" });
}

export async function buildDeck(spec: DeckSpec): Promise<Buffer> {
  const t = deckTheme(spec.theme);
  const firm = clean(spec.preparedBy ?? "") || "Anchor.AI";
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.title = spec.title;
  pptx.company = firm;
  const today = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Cover
  const cover = pptx.addSlide();
  cover.background = { color: t.primary };
  const textW = spec.coverPhoto ? 5.9 : 8.6;
  if (spec.coverPhoto) await photoPanel(pptx, cover, spec.coverPhoto, t);
  else rings(pptx, cover, t);
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: t.accent }, line: { color: t.accent } });
  if (spec.logo) logoChip(pptx, cover, spec.logo, 0.9, 0.7);
  cover.addText((clean(spec.client ?? "") || "Confidential").toUpperCase(), {
    x: 0.9, y: 1.95, w: textW, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: t.accentOnDark, charSpacing: 3,
  });
  cover.addText(clean(spec.title), { x: 0.9, y: 2.4, w: textW, h: 1.9, fontFace: SERIF, fontSize: spec.coverPhoto ? 34 : 40, color: WHITE, valign: "top", fit: "shrink" });
  cover.addShape(pptx.ShapeType.line, { x: 0.9, y: 4.5, w: 1.4, h: 0, line: { color: t.accentOnDark, width: 2.5 } });
  if (spec.subtitle) cover.addText(clean(spec.subtitle), { x: 0.9, y: 4.7, w: textW - 0.4, h: 0.9, fontFace: FONT, fontSize: 17, color: t.onPrimaryMuted, valign: "top", fit: "shrink" });
  cover.addText(
    [
      { text: `Prepared by ${firm}`, options: { bold: true, color: WHITE, breakLine: true } },
      { text: `${today}  ·  Strictly confidential`, options: { color: t.onPrimaryMuted } },
    ],
    { x: 0.9, y: 6.2, w: textW, h: 0.75, fontFace: FONT, fontSize: 12, valign: "bottom" }
  );

  let n = 2;
  let section = 0;
  let kicker = clean(spec.client ?? "") || clean(spec.title);

  const frame = (s: PptxGenJS.Slide, d: DeckSlide) => {
    s.background = { color: WHITE };
    if (spec.logo) {
      const lh = 0.32;
      const lw = Math.min(1.6, lh * spec.logo.aspect);
      s.addImage({ data: spec.logo.data, x: W - MX - lw, y: 0.3, w: lw, h: lh });
    }
    s.addText(kicker.toUpperCase().slice(0, 80), { x: MX, y: 0.32, w: CW - 2, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: t.accent, charSpacing: 2 });
    s.addText(clean(d.title), { x: MX, y: 0.62, w: CW, h: 0.95, fontFace: FONT, fontSize: 26, bold: true, color: t.primary, valign: "top", fit: "shrink" });
    s.addShape(pptx.ShapeType.rect, { x: MX, y: 1.62, w: 0.9, h: 0.05, fill: { color: t.accent }, line: { color: t.accent } });
    s.addShape(pptx.ShapeType.line, { x: MX, y: 6.95, w: CW, h: 0, line: { color: HAIRLINE, width: 0.75 } });
    s.addText(d.source ? `Source: ${clean(d.source)}` : "", { x: MX, y: 7.0, w: 9.2, h: 0.32, fontFace: FONT, fontSize: 9, color: MUTED, fit: "shrink" });
    s.addText(
      [
        { text: `${firm}  ·  Confidential   `, options: { color: MUTED } },
        { text: String(n), options: { color: t.primary, bold: true } },
      ],
      { x: W - MX - 3.4, y: 7.0, w: 3.4, h: 0.32, fontFace: FONT, fontSize: 9, align: "right" }
    );
  };

  for (const d of spec.slides.slice(0, MAX_SLIDES)) {
    const s = pptx.addSlide();
    if (d.notes) s.addNotes(d.notes);

    if (d.layout === "image") {
      await imageSlide(pptx, s, d, t, n);
      n++;
      continue;
    }

    if (d.layout === "title" || d.layout === "section") {
      s.background = { color: t.primary };
      if (d.photo) await photoPanel(pptx, s, d.photo, t);
      else rings(pptx, s, t);
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: t.accent }, line: { color: t.accent } });
      if (d.layout === "section") {
        section++;
        kicker = clean(d.title);
        s.addText(String(section).padStart(2, "0"), { x: 0.9, y: 1.7, w: 3, h: 1.1, fontFace: SERIF, fontSize: 60, color: t.accentOnDark });
      }
      s.addText(clean(d.title), { x: 0.9, y: 2.9, w: d.photo ? 5.9 : 8.6, h: 1.5, fontFace: SERIF, fontSize: 34, color: WHITE, valign: "top", fit: "shrink" });
      if (d.subtitle) s.addText(clean(d.subtitle), { x: 0.9, y: 4.5, w: d.photo ? 5.5 : 8.2, h: 0.9, fontFace: FONT, fontSize: 16, color: t.onPrimaryMuted, valign: "top", fit: "shrink" });
      s.addText(String(n), { x: W - MX - 1, y: 7.0, w: 1, h: 0.32, fontFace: FONT, fontSize: 9, color: t.onPrimaryMuted, align: "right" });
      n++;
      continue;
    }

    frame(s, d);
    n++;
    const body = { x: MX, y: 1.95, w: CW, h: 4.85 };
    if (d.subtitle) {
      s.addText(clean(d.subtitle), { x: body.x, y: body.y - 0.12, w: body.w, h: 0.45, fontFace: FONT, fontSize: 15, color: MUTED });
      body.y += 0.45;
      body.h -= 0.45;
    }
    if (d.takeaway) body.h -= 0.8;
    // A photo beside the content: the right third of the slide.
    if (d.photo && ["bullets", "metrics", "two_column", "agenda", "quote"].includes(d.layout)) {
      const pw = 4.3;
      const px = d.layout === "quote" ? body.x : body.x + body.w - pw;
      s.addImage({ data: await fitPhoto(d.photo, pw, body.h), x: px, y: body.y, w: pw, h: body.h });
      s.addShape(pptx.ShapeType.rect, { x: px, y: body.y + body.h - 0.06, w: pw, h: 0.06, fill: { color: t.accent }, line: { color: t.accent } });
      body.w -= pw + 0.45;
      if (d.layout === "quote") body.x += pw + 0.45;
    }

    if (d.layout === "bullets" || (!["two_column", "metrics", "table", "chart", "agenda", "timeline", "comparison", "quote", "gallery", "image"].includes(d.layout) && d.bullets?.length)) {
      bulletRows(pptx, s, d.bullets ?? [], t, { x: body.x, y: body.y + 0.05, w: body.w, h: body.h - 0.05 });
    } else if (d.layout === "two_column") {
      const gap = 0.35;
      const cw = (body.w - gap) / 2;
      const col = (c: DeckSlide["left"], x: number) => {
        if (!c) return;
        const count = Math.min((c.bullets ?? []).length, 7);
        const cardH = Math.min(body.h, (c.heading ? 1.05 : 0.25) + count * 0.85 + 0.25);
        s.addShape(pptx.ShapeType.rect, { x, y: body.y, w: cw, h: cardH, fill: { color: t.soft }, line: { color: t.soft }, rectRadius: 0.08 });
        let y = body.y + 0.25;
        if (c.heading) {
          s.addText(clean(c.heading), { x: x + 0.3, y, w: cw - 0.6, h: 0.5, fontFace: FONT, fontSize: 17, bold: true, color: t.primary, valign: "middle", fit: "shrink" });
          s.addShape(pptx.ShapeType.rect, { x: x + 0.3, y: y + 0.55, w: 0.6, h: 0.04, fill: { color: t.accent }, line: { color: t.accent } });
          y += 0.8;
        }
        bulletRows(pptx, s, c.bullets ?? [], t, { x: x + 0.3, y, w: cw - 0.6, h: body.y + cardH - y - 0.2 }, 15);
      };
      col(d.left, body.x);
      col(d.right, body.x + cw + gap);
    } else if (d.layout === "metrics") {
      const items = (d.metrics ?? []).slice(0, 4);
      const gap = 0.3;
      const w = (body.w - gap * (items.length - 1)) / Math.max(items.length, 1);
      const cardH = d.bullets?.length ? 2.3 : Math.min(3.0, body.h);
      items.forEach((m, i) => {
        const x = body.x + i * (w + gap);
        s.addShape(pptx.ShapeType.rect, { x, y: body.y, w, h: cardH, fill: { color: WHITE }, line: { color: HAIRLINE, width: 1 }, rectRadius: 0.06 });
        s.addShape(pptx.ShapeType.rect, { x, y: body.y, w, h: 0.07, fill: { color: t.accent }, line: { color: t.accent } });
        s.addText(clean(m.value), { x: x + 0.25, y: body.y + 0.3, w: w - 0.5, h: cardH * 0.45, fontFace: SERIF, fontSize: w < 2.4 ? 28 : w < 3 ? 34 : 40, color: t.primary, valign: "middle", fit: "shrink" });
        s.addText(clean(m.label), { x: x + 0.25, y: body.y + 0.3 + cardH * 0.45, w: w - 0.5, h: cardH * 0.4, fontFace: FONT, fontSize: 13, color: MUTED, valign: "top", fit: "shrink" });
      });
      if (d.bullets?.length) {
        bulletRows(pptx, s, d.bullets, t, { x: body.x, y: body.y + cardH + 0.3, w: body.w, h: body.h - cardH - 0.3 }, 15);
      }
    } else if (d.layout === "table" && d.table?.length) {
      const src = d.table.slice(0, 14).map((r) => r.slice(0, 8).map((c) => clean(String(c ?? ""))));
      const fontSize = src.length > 10 ? 12 : src.length > 7 ? 14 : 16;
      // Rows fill the space (up to a comfortable height) instead of
      // bunching at the top of the slide.
      const rowH = Math.min(0.62, body.h / src.length);
      const none = { type: "none" as const };
      const hair = { type: "solid" as const, pt: 0.75, color: HAIRLINE };
      const rows = src.map((r, ri) => {
        const total = ri > 0 && /^(total|sum|overall)/i.test(r[0] ?? "");
        return r.map((text, ci) => ({
          text,
          options:
            ri === 0
              ? { bold: true, color: WHITE, fill: { color: t.primary }, align: ci === 0 ? ("left" as const) : ("right" as const), border: [none, none, none, none] as Edges }
              : {
                  color: ci === 0 || total ? t.primary : INK,
                  bold: ci === 0 || total,
                  fill: { color: total ? t.accentSoft : ri % 2 === 0 ? t.soft : WHITE },
                  align: ci > 0 && isNumeric(text) ? ("right" as const) : ("left" as const),
                  border: [total ? { type: "solid" as const, pt: 1.25, color: t.primary } : none, none, hair, none] as Edges,
                },
        }));
      });
      s.addTable(rows, { x: body.x, y: body.y, w: body.w, rowH, fontFace: FONT, fontSize, margin: [4, 10, 4, 10], valign: "middle", autoPage: false });
    } else if (d.layout === "chart" && d.chart?.series?.length) {
      const c = d.chart;
      const data = c.series.slice(0, 6).map((sr) => ({ name: clean(sr.name), labels: c.categories.map(clean), values: sr.values }));
      const type = c.type === "line" ? pptx.ChartType.line : c.type === "pie" ? pptx.ChartType.doughnut : pptx.ChartType.bar;
      const side = d.bullets?.length ? 4.1 : 0;
      s.addChart(type, data, {
        x: body.x,
        y: body.y,
        w: body.w - (side ? side + 0.35 : 0),
        h: body.h,
        barGrouping: c.type === "stacked_bar" ? "stacked" : "clustered",
        barGapWidthPct: 60,
        // One series: every bar the same colour (several colours would
        // look like different things).
        chartColors: c.series.length === 1 && c.type !== "pie" ? [t.primary] : t.chart,
        // Bars start at zero so growth isn't exaggerated.
        ...(c.type === "line" || c.type === "pie" ? {} : { valAxisMinVal: 0 }),
        ...(c.type === "line" ? { lineSize: 2.5, lineDataSymbol: "circle", lineDataSymbolSize: 7 } : {}),
        ...(c.type === "pie" ? { holeSize: 55, showPercent: true } : {}),
        showLegend: c.series.length > 1 || c.type === "pie",
        legendPos: "b",
        legendFontFace: FONT,
        legendFontSize: 11,
        legendColor: MUTED,
        showValue: c.type !== "line" && c.type !== "pie",
        dataLabelFormatCode: numberFormat(c.valueFormat, c.series.flatMap((sr) => sr.values)),
        dataLabelColor: INK,
        dataLabelFontSize: 11,
        dataLabelPosition: c.type === "bar" ? "outEnd" : undefined,
        valAxisLabelFormatCode: numberFormat(c.valueFormat),
        valAxisHidden: c.type === "bar" && c.series.length === 1,
        valAxisLineShow: false,
        valAxisLabelColor: MUTED,
        catAxisLabelColor: MUTED,
        catAxisLineShow: true,
        catAxisLineColor: HAIRLINE,
        catAxisLabelFontFace: FONT,
        valAxisLabelFontFace: FONT,
        dataLabelFontFace: FONT,
        catAxisLabelFontSize: 11,
        valAxisLabelFontSize: 10,
        valGridLine: c.type === "bar" && c.series.length === 1 ? { style: "none" } : { color: "EEF0F3", size: 0.5 },
      });
      if (side) {
        const x = body.x + body.w - side;
        s.addShape(pptx.ShapeType.rect, { x, y: body.y, w: side, h: body.h, fill: { color: t.soft }, line: { color: t.soft }, rectRadius: 0.06 });
        s.addText("WHAT IT SHOWS", { x: x + 0.3, y: body.y + 0.2, w: side - 0.6, h: 0.35, fontFace: FONT, fontSize: 10, bold: true, color: t.accent, charSpacing: 2 });
        bulletRows(pptx, s, d.bullets ?? [], t, { x: x + 0.3, y: body.y + 0.6, w: side - 0.6, h: body.h - 0.8 }, 13);
      }
    } else if (d.layout === "agenda") {
      const items = (d.bullets ?? []).map(clean).filter(Boolean).slice(0, 8);
      const rowH = Math.min(0.72, body.h / Math.max(items.length, 1));
      items.forEach((item, i) => {
        const y = body.y + i * rowH;
        s.addText(String(i + 1).padStart(2, "0"), { x: body.x, y, w: 0.9, h: rowH, fontFace: SERIF, fontSize: 22, color: t.accent, valign: "middle" });
        s.addText(item, { x: body.x + 1.0, y, w: body.w - 1.0, h: rowH, fontFace: FONT, fontSize: 19, color: t.primary, valign: "middle", fit: "shrink" });
        s.addShape(pptx.ShapeType.line, { x: body.x + 1.0, y: y + rowH, w: body.w - 1.0, h: 0, line: { color: HAIRLINE, width: 0.75 } });
      });
    } else if (d.layout === "timeline" && d.steps?.length) {
      const steps = d.steps.slice(0, 6);
      const w = body.w / steps.length;
      const lineY = body.y + 1.0;
      s.addShape(pptx.ShapeType.line, { x: body.x + w / 2, y: lineY, w: body.w - w, h: 0, line: { color: t.accent, width: 2 } });
      steps.forEach((st, i) => {
        const x = body.x + i * w;
        s.addText(clean(st.when), { x, y: body.y + 0.1, w, h: 0.55, fontFace: FONT, fontSize: 14, bold: true, color: t.accent, align: "center", fit: "shrink" });
        s.addShape(pptx.ShapeType.ellipse, { x: x + w / 2 - 0.17, y: lineY - 0.17, w: 0.34, h: 0.34, fill: { color: t.primary }, line: { color: WHITE, width: 2.5 } });
        s.addShape(pptx.ShapeType.rect, { x: x + 0.1, y: lineY + 0.4, w: w - 0.2, h: 1.75, fill: { color: t.soft }, line: { color: t.soft }, rectRadius: 0.06 });
        s.addText(clean(st.what), { x: x + 0.2, y: lineY + 0.5, w: w - 0.4, h: 1.05, fontFace: FONT, fontSize: 15, color: INK, align: "center", valign: "top", fit: "shrink" });
        if (st.owner) s.addText(clean(st.owner), { x: x + 0.2, y: lineY + 1.6, w: w - 0.4, h: 0.45, fontFace: FONT, fontSize: 11, bold: true, color: t.primary, align: "center" });
      });
      if (d.bullets?.length) {
        bulletRows(pptx, s, d.bullets, t, { x: body.x, y: lineY + 2.45, w: body.w, h: body.y + body.h - (lineY + 2.45) }, 14);
      }
    } else if (d.layout === "comparison" && d.options?.length) {
      const opts = d.options.slice(0, 4);
      const gap = 0.3;
      const w = (body.w - gap * (opts.length - 1)) / opts.length;
      // Cards as tall as their longest list, not the whole slide.
      const longest = Math.max(...opts.map((o) => (o.bullets ?? []).slice(0, 8).reduce((sum, b) => sum + Math.ceil((clean(b).length * 0.085) / Math.max(w - 0.6, 1)), 0)));
      const cardH = Math.min(body.h, Math.max(2.4, 1.55 + longest * 0.42));
      opts.forEach((o, i) => {
        const x = body.x + i * (w + gap);
        const rec = o.recommended === true;
        const head = rec ? t.accent : t.primary;
        s.addShape(pptx.ShapeType.rect, { x, y: body.y, w, h: cardH, fill: { color: rec ? t.accentSoft : WHITE }, line: { color: rec ? t.accent : HAIRLINE, width: rec ? 2 : 1 } });
        s.addShape(pptx.ShapeType.rect, { x, y: body.y, w, h: 0.75, fill: { color: head }, line: { color: head } });
        s.addText(clean(o.name), { x: x + 0.2, y: body.y, w: w - 0.4, h: 0.75, fontFace: FONT, fontSize: 15, bold: true, color: WHITE, valign: "middle", fit: "shrink" });
        let y = body.y + 0.9;
        if (rec) {
          s.addText("RECOMMENDED", { x: x + 0.2, y, w: w - 0.4, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: t.accent, charSpacing: 2 });
          y += 0.35;
        }
        s.addText(bulletRuns(o.bullets ?? []), { x: x + 0.2, y, w: w - 0.4, h: body.y + cardH - y - 0.15, fontFace: FONT, fontSize: opts.length > 3 ? 14 : 16, valign: "top", fit: "shrink" });
      });
    } else if (d.layout === "gallery" && d.galleryPhotos?.some(Boolean)) {
      const items = (d.gallery ?? []).slice(0, 4).map((g, i) => ({ caption: clean(g.caption), photo: d.galleryPhotos?.[i] ?? null })).filter((g) => g.photo);
      const gap = 0.3;
      const w = (body.w - gap * (items.length - 1)) / items.length;
      const ph = Math.min(body.h - 0.9, w * 0.75);
      for (const [i, g] of items.entries()) {
        const x = body.x + i * (w + gap);
        s.addImage({ data: await fitPhoto(g.photo!, w, ph), x, y: body.y, w, h: ph });
        s.addShape(pptx.ShapeType.rect, { x, y: body.y + ph, w, h: 0.06, fill: { color: t.accent }, line: { color: t.accent } });
        s.addText(g.caption, { x, y: body.y + ph + 0.15, w, h: 0.7, fontFace: FONT, fontSize: 14, bold: true, color: t.primary, valign: "top", fit: "shrink" });
      }
      if (d.bullets?.length && body.h - ph - 0.9 > 0.6) {
        bulletRows(pptx, s, d.bullets, t, { x: body.x, y: body.y + ph + 0.9, w: body.w, h: body.h - ph - 0.9 }, 14);
      }
    } else if (d.layout === "quote" && d.quote?.text) {
      s.addShape(pptx.ShapeType.rect, { x: body.x, y: body.y + 0.2, w: 0.08, h: Math.min(3.6, body.h - 0.4), fill: { color: t.accent }, line: { color: t.accent } });
      s.addText("“", { x: body.x + 0.5, y: body.y - 0.1, w: 1.2, h: 1.3, fontFace: SERIF, fontSize: 100, color: t.accent, transparency: 45 });
      s.addText(clean(d.quote.text), { x: body.x + 0.9, y: body.y + 0.5, w: body.w - 1.8, h: 2.6, fontFace: SERIF, fontSize: 26, italic: true, color: t.primary, valign: "middle", fit: "shrink" });
      if (d.quote.by) s.addText(`— ${clean(d.quote.by)}`, { x: body.x + 0.9, y: body.y + 3.2, w: body.w - 1.8, h: 0.5, fontFace: FONT, fontSize: 14, bold: true, color: MUTED });
    }

    // The "so what", in a band above the source line.
    if (d.takeaway) {
      s.addShape(pptx.ShapeType.rect, { x: MX, y: 6.15, w: CW, h: 0.62, fill: { color: t.accentSoft }, line: { color: t.accentSoft } });
      s.addShape(pptx.ShapeType.rect, { x: MX, y: 6.15, w: 0.08, h: 0.62, fill: { color: t.accent }, line: { color: t.accent } });
      s.addText(
        [
          { text: "SO WHAT   ", options: { bold: true, color: t.accent, fontSize: 10, charSpacing: 2 } },
          { text: clean(d.takeaway), options: { bold: true, color: t.primary, fontSize: 14 } },
        ],
        { x: MX + 0.3, y: 6.15, w: CW - 0.45, h: 0.62, fontFace: FONT, valign: "middle", fit: "shrink" }
      );
    }
  }

  // Sources appendix: every slide's source in one place, unless the deck
  // already ends with its own.
  const sourced = spec.slides.slice(0, MAX_SLIDES).filter((d) => d.source?.trim());
  const hasOwn = spec.slides.some((d) => /^sources?\b/i.test(d.title.trim()));
  if (sourced.length && !hasOwn) {
    const s = pptx.addSlide();
    kicker = "Appendix";
    frame(s, { layout: "bullets", title: "Sources" });
    n++;
    const lines = sourced.slice(0, 16).map((d) => `${clean(d.title).slice(0, 70)}${d.title.length > 70 ? "…" : ""}: ${clean(d.source!)}`);
    s.addText(bulletRuns(lines), { x: MX, y: 1.95, w: CW, h: 4.85, fontFace: FONT, fontSize: 11.5, valign: "top", fit: "shrink" });
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(out as ArrayBuffer);
}
