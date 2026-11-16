import { lookup } from "dns/promises";
import { isIP } from "net";

// A firm's brand colours, read from its own website, so the decks Ask
// Anchor makes look like they came from that firm: the theme-color meta
// tag, CSS variables named like brand/primary/accent, and the colours its
// stylesheets use most. Returns a dark "primary" (cover, titles, table
// headers) and an "accent" (rules, highlights), or null when the site
// can't be read or has no usable colour.

export type BrandColors = { primary: string; accent: string | null; source: string };

const TIMEOUT_MS = 6000;
const MAX_BYTES = 1_500_000;
const CACHE_MS = 24 * 3600_000;
const cache = new Map<string, { at: number; value: BrandColors | null }>();

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}
export function rgbToHex([r, g, b]: RGB): string {
  return [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}
// Relative luminance, 0 (black) to 1 (white).
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}
// Hue in degrees (0 red, 30 orange, 60 yellow, 120 green, 240 blue).
export function hue(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
// Mixes a colour toward another: amount 0 keeps a, 1 gives b.
export function mix(a: string, b: string, amount: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as RGB);
}
export function colorDistance(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}

function normalize(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) return rgbToHex(hexToRgb(m[1]));
  m = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) < (m[4].endsWith("%") ? 60 : 0.6)) return null;
    return rgbToHex([+m[1], +m[2], +m[3]]);
  }
  return null;
}

// Neutral greys, near-white and near-black say nothing about the brand.
function isNeutral(hex: string): boolean {
  const l = luminance(hex);
  return saturation(hex) < 0.18 || l > 0.85 || l < 0.012;
}

// Only public websites: no IP addresses, no internal names, and the name
// must not resolve to a private address.
async function isPublicHost(host: string): Promise<boolean> {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) || isIP(host) || /(^|\.)(localhost|local|internal|lan)$/i.test(host)) return false;
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}
function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) return /^(::1|::|f[cd]|fe80|::ffff:(10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function fetchText(url: string): Promise<string | null> {
  const host = new URL(url).hostname;
  if (!(await isPublicHost(host))) return null;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AnchorDeckBuilder/1.0)", Accept: "text/html,text/css,*/*" },
  });
  if (!res.ok) return null;
  // The redirect target has to be public too.
  if (res.url && !(await isPublicHost(new URL(res.url).hostname))) return null;
  const text = await res.text();
  return text.slice(0, MAX_BYTES);
}

export function cleanDomain(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

// Scores every colour on the page and its stylesheets; exported for tests.
export function pickBrandColors(html: string, css: string[]): { primary: string; accent: string | null } | null {
  const scores = new Map<string, number>();
  const add = (raw: string, weight: number, allowNeutral = false) => {
    const hex = normalize(raw);
    if (!hex || (!allowNeutral && isNeutral(hex))) return;
    scores.set(hex, (scores.get(hex) ?? 0) + weight);
  };
  const COLOR = "(#[0-9a-fA-F]{6}\\b|#[0-9a-fA-F]{3}\\b|rgba?\\([^)]*\\))";

  for (const m of html.matchAll(/<meta[^>]+name=["'](theme-color|msapplication-TileColor)["'][^>]*>/gi)) {
    const c = m[0].match(/content=["']([^"']+)["']/i)?.[1];
    if (c) add(c, 40, true);
  }
  const allCss = [html.match(/<style[\s\S]*?<\/style>/gi)?.join("\n") ?? "", ...css].join("\n");
  // Variables a designer named after the brand.
  for (const m of allCss.matchAll(new RegExp(`--[\\w-]*(brand|primary|main|theme|accent|secondary)[\\w-]*\\s*:\\s*${COLOR}`, "gi"))) {
    add(m[2], /accent|secondary/i.test(m[1]) ? 15 : 25);
  }
  // Colours buttons and links are painted with.
  for (const m of allCss.matchAll(new RegExp(`(?:\\.btn|button|\\ba\\b|\\.button|header|nav)[^{}]*\\{[^}]*?(?:background(?:-color)?|color)\\s*:\\s*${COLOR}`, "gi"))) {
    add(m[1], 4);
  }
  for (const m of allCss.matchAll(new RegExp(COLOR, "g"))) add(m[1], 1);
  for (const m of html.matchAll(new RegExp(`style=["'][^"']*?(?:color|background)[^"']*?${COLOR}`, "gi"))) add(m[1], 2);

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  if (!ranked.length) return null;
  const dark = ranked.filter((h) => luminance(h) < 0.2 && !isNeutral(h));
  const primary = dark[0] ?? ranked[0];
  const accent = ranked.find((h) => h !== primary && colorDistance(h, primary) > 90 && !isNeutral(h)) ?? null;
  return { primary, accent };
}

export async function brandColorsForDomain(input: string): Promise<BrandColors | null> {
  const domain = cleanDomain(input);
  if (!domain) return null;
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: BrandColors | null = null;
  try {
    const base = `https://${domain}/`;
    const html = (await fetchText(base)) ?? (await fetchText(`https://www.${domain}/`));
    if (html) {
      const links = [...html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)]
        .map((m) => m[0].match(/href=["']([^"']+)["']/i)?.[1])
        .filter((h): h is string => Boolean(h) && !/fonts\.googleapis|font-awesome|bootstrap\.min/i.test(h!))
        .slice(0, 3)
        .map((h) => new URL(h, base).toString());
      const css = (await Promise.all(links.map((u) => fetchText(u).catch(() => null)))).filter((c): c is string => Boolean(c));
      const picked = pickBrandColors(html, css);
      if (picked) value = { ...picked, source: domain };
    }
  } catch (err) {
    console.warn(`[brandColors] couldn't read ${domain}:`, err instanceof Error ? err.message : err);
  }
  cache.set(domain, { at: Date.now(), value });
  return value;
}
