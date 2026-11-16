import { createHash } from "crypto";
import sharp from "sharp";
import { cleanDomain, fetchPublicBytes, fetchPublicPage } from "@/lib/brandColors";

// Photos and logos for the decks Ask Anchor makes (presentationDeck.ts):
// the company's own website (its hero and share images, and its logo),
// photos in the person's Dropbox or Google Drive, and image links the AI
// found. Everything is checked, de-duplicated and shrunk to a size a deck
// can carry; slides crop each photo to fit its frame.

export type DeckPhoto = { data: Buffer; w: number; h: number; source: string };

const MIN_W = 800;
const MIN_H = 450;
const MAX_EDGE = 2000;

// Normalises any image (JPEG, PNG, WebP, AVIF, SVG…) to a JPEG no larger
// than the deck needs; null if it isn't an image or is too small.
export async function preparePhoto(input: Buffer, source: string, minW = MIN_W, minH = MIN_H): Promise<DeckPhoto | null> {
  try {
    const img = sharp(input, { failOn: "none", limitInputPixels: 80_000_000 }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height || meta.width < minW || meta.height < minH) return null;
    const aspect = meta.width / meta.height;
    if (aspect > 3.2 || aspect < 0.5) return null; // banners and strips
    const { data, info } = await img
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height, source };
  } catch {
    return null;
  }
}

// A photo cropped to exactly fill a frame (w × h inches), keeping the
// most interesting part, as the data string pptxgenjs takes.
export async function fitPhoto(photo: DeckPhoto, w: number, h: number): Promise<string> {
  const pxW = Math.min(MAX_EDGE, Math.round(w * 160));
  const pxH = Math.round((pxW * h) / w);
  const out = await sharp(photo.data).resize(pxW, pxH, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  return `image/jpeg;base64,${out.toString("base64")}`;
}

// A logo as a PNG data string with its aspect ratio; transparent
// backgrounds are kept.
export type DeckLogo = { data: string; aspect: number };
export async function prepareLogo(input: Buffer): Promise<DeckLogo | null> {
  try {
    const img = sharp(input, { failOn: "none", density: 300 });
    const meta = await img.metadata();
    if (!meta.width || !meta.height || meta.width < 60 || meta.height < 24) return null;
    const out = await img.resize({ width: 800, height: 400, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
    return { data: `image/png;base64,${out.data.toString("base64")}`, aspect: out.info.width / out.info.height };
  } catch {
    return null;
  }
}

function absolute(src: string, base: string): string | null {
  try {
    const u = new URL(src.trim().replace(/&amp;/g, "&"), base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// The biggest entry of a srcset ("a.jpg 640w, b.jpg 1600w").
function largestFromSrcset(srcset: string): string | null {
  const parts = srcset.split(",").map((p) => p.trim().split(/\s+/));
  const best = parts.map(([url, size]) => ({ url, n: parseFloat(size ?? "0") || 0 })).sort((a, b) => b.n - a.n)[0];
  return best?.url ?? null;
}

const NOT_A_PHOTO = /logo|icon|favicon|sprite|avatar|badge|pixel|spinner|loader|placeholder|blank|flag|payment|\.svg(\?|$)|\.gif(\?|$)|data:/i;

// Candidate photo and logo URLs on a page, best first.
export function imageCandidates(html: string, base: string): { photos: string[]; logos: string[] } {
  const photos: string[] = [];
  const logos: string[] = [];
  const push = (list: string[], raw: string | null | undefined) => {
    const url = raw ? absolute(raw, base) : null;
    if (url && !list.includes(url)) list.push(url);
  };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi)) {
    push(photos, m[0].match(/content=["']([^"']+)["']/i)?.[1]);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (name: string) => tag.match(new RegExp(`\\s${name}=["']([^"']+)["']`, "i"))?.[1];
    const srcset = attr("srcset") ?? attr("data-srcset");
    const src = (srcset && largestFromSrcset(srcset)) ?? attr("data-src") ?? attr("data-lazy-src") ?? attr("src");
    if (!src) continue;
    const label = `${src} ${attr("alt") ?? ""} ${attr("class") ?? ""} ${attr("id") ?? ""}`;
    if (/logo/i.test(label)) push(logos, src);
    else if (!NOT_A_PHOTO.test(src)) push(photos, src);
  }
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    if (!NOT_A_PHOTO.test(m[1])) push(photos, m[1]);
  }
  for (const m of html.matchAll(/<link[^>]+rel=["'](?:apple-touch-icon|icon)["'][^>]*>/gi)) {
    push(logos, m[0].match(/href=["']([^"']+)["']/i)?.[1]);
  }
  return { photos, logos };
}

const cache = new Map<string, { at: number; value: { photos: DeckPhoto[]; logo: DeckLogo | null } }>();

// Photos (hero and share images, large pictures) and the logo from a
// company's website: the home page, plus one inner page for more photos.
export async function websiteImages(input: string, maxPhotos = 6): Promise<{ photos: DeckPhoto[]; logo: DeckLogo | null }> {
  const domain = cleanDomain(input);
  if (!domain) return { photos: [], logo: null };
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.value;
  const base = `https://${domain}/`;
  const html = (await fetchPublicPage(base)) ?? (await fetchPublicPage(`https://www.${domain}/`)) ?? "";
  const { photos: urls, logos } = imageCandidates(html, base);
  // An inner page (about, portfolio, properties…) usually has the best
  // photos of what the company actually does.
  const inner = html.match(/href=["']([^"']*\/(?:about|portfolio|properties|hotels|projects|our-work|gallery|locations|rooms)[^"']*)["']/i)?.[1];
  if (inner && urls.length < 12) {
    const innerUrl = absolute(inner, base);
    const page = innerUrl ? await fetchPublicPage(innerUrl) : null;
    if (page && innerUrl) for (const u of imageCandidates(page, innerUrl).photos) if (!urls.includes(u)) urls.push(u);
  }
  const photos = await downloadPhotos(urls.slice(0, 16), domain, maxPhotos);
  let logo: DeckLogo | null = null;
  for (const url of logos.slice(0, 4)) {
    const got = await fetchPublicBytes(url, 3_000_000).catch(() => null);
    logo = got ? await prepareLogo(got.data) : null;
    if (logo) break;
  }
  const value = { photos, logo };
  cache.set(domain, { at: Date.now(), value });
  return value;
}

// Downloads image links (from a website, or ones the AI found), keeping
// real photos and skipping duplicates.
export async function downloadPhotos(urls: string[], source: string, max: number): Promise<DeckPhoto[]> {
  const results = await Promise.all(
    urls.map(async (url) => {
      const got = await fetchPublicBytes(url).catch(() => null);
      if (!got || (got.type && !/^image\//i.test(got.type) && !/octet-stream/i.test(got.type))) return null;
      return preparePhoto(got.data, source);
    })
  );
  return dedupe(results.filter((p): p is DeckPhoto => Boolean(p))).slice(0, max);
}

export function dedupe(photos: DeckPhoto[]): DeckPhoto[] {
  const seen = new Set<string>();
  return photos.filter((p) => {
    const key = createHash("sha1").update(p.data.subarray(0, 4096)).digest("hex") + `${p.w}x${p.h}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
