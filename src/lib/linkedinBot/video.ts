import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp, { type OverlayOptions } from "sharp";
import ffmpegStatic from "ffmpeg-static";
import type { Slide } from "./write";

// Turns the weekly video's slides into a square MP4 in Anchor's colours:
// each slide is drawn as an image (sharp, with the bundled Inter font so
// it looks the same on any server), then ffmpeg joins them with fades.
const SIZE = 1080;
const MARGIN = 96;
const SECONDS_PER_SLIDE = 6;
const FADE = 0.5;
const NAVY = "#0b1930";
const NAVY_LIGHT = "#12294a";
const COPPER = "#b4531f";

const FONTS = path.join(process.cwd(), "assets", "fonts");
const BOLD = path.join(FONTS, "Inter-Bold.ttf");
const REGULAR = path.join(FONTS, "Inter-Regular.ttf");

const run = promisify(execFile);

function escapeMarkup(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function textImage(text: string, opts: { bold: boolean; size: number; color: string; width: number }) {
  const font = opts.bold ? BOLD : REGULAR;
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${opts.color}">${escapeMarkup(text)}</span>`,
      font: `Inter ${opts.bold ? "Bold" : "Regular"} ${opts.size}`,
      fontfile: font,
      width: opts.width,
      wrap: "word-char",
      rgba: true,
      spacing: Math.round(opts.size * (opts.bold ? 0.1 : 0.25)),
      dpi: 72,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function rect(width: number, height: number, color: string) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

async function drawSlide(slide: Slide, index: number, total: number): Promise<Buffer> {
  const last = index === total - 1;
  const textWidth = SIZE - MARGIN * 2;
  const brand = await textImage("AI ANCHOR", { bold: true, size: 26, color: "#ffffff", width: 400 });
  const counter = await textImage(`${index + 1}/${total}`, { bold: false, size: 26, color: "#9fb0c8", width: 200 });
  const title = await textImage(slide.title, { bold: true, size: index === 0 ? 72 : 60, color: "#ffffff", width: textWidth });
  const body = slide.body?.trim()
    ? await textImage(slide.body, { bold: false, size: 40, color: "#d6deea", width: textWidth })
    : null;
  const follow = last
    ? await textImage("Follow AI Anchor for more", { bold: true, size: 30, color: COPPER, width: textWidth })
    : null;

  // Title and body sit together, centred vertically in the space between
  // the top bar and the progress bar.
  const accentGap = 36;
  const gap = 40;
  const blockHeight = 8 + accentGap + title.height + (body ? gap + body.height : 0) + (follow ? gap + follow.height : 0);
  let y = Math.max(180, Math.round((SIZE - blockHeight) / 2));

  const layers: OverlayOptions[] = [
    { input: await rect(SIZE, 12, NAVY_LIGHT), top: 0, left: 0 },
    { input: brand.data, top: MARGIN - 20, left: MARGIN },
    { input: counter.data, top: MARGIN - 20, left: SIZE - MARGIN - counter.width },
    { input: await rect(96, 8, COPPER), top: y, left: MARGIN },
  ];
  y += 8 + accentGap;
  layers.push({ input: title.data, top: y, left: MARGIN });
  y += title.height;
  if (body) {
    y += gap;
    layers.push({ input: body.data, top: y, left: MARGIN });
    y += body.height;
  }
  if (follow) {
    y += gap;
    layers.push({ input: follow.data, top: y, left: MARGIN });
  }
  // Progress bar along the bottom.
  const barWidth = SIZE - MARGIN * 2;
  layers.push({ input: await rect(barWidth, 6, "#2a3f5f"), top: SIZE - MARGIN, left: MARGIN });
  layers.push({
    input: await rect(Math.max(6, Math.round((barWidth * (index + 1)) / total)), 6, COPPER),
    top: SIZE - MARGIN,
    left: MARGIN,
  });

  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: NAVY } })
    .composite(layers)
    .flatten({ background: NAVY })
    .png()
    .toBuffer();
}

// The first slide on its own, used as the video's cover image.
export async function renderCoverImage(slides: Slide[]): Promise<Buffer> {
  return drawSlide(slides[0], 0, slides.length);
}

export async function renderSlideVideo(slides: Slide[]): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anchor-li-video-"));
  try {
    const inputs: string[] = [];
    const filters: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const file = path.join(dir, `slide${i}.png`);
      await writeFile(file, await drawSlide(slides[i], i, slides.length));
      inputs.push("-loop", "1", "-t", String(SECONDS_PER_SLIDE), "-i", file);
      filters.push(
        `[${i}:v]fade=t=in:st=0:d=${FADE},fade=t=out:st=${SECONDS_PER_SLIDE - FADE}:d=${FADE},setsar=1[v${i}]`,
      );
    }
    const total = slides.length * SECONDS_PER_SLIDE;
    const concat = `${slides.map((_, i) => `[v${i}]`).join("")}concat=n=${slides.length}:v=1:a=0,format=yuv420p[out]`;
    const out = path.join(dir, "video.mp4");
    await run(
      ffmpegStatic || "ffmpeg",
      [
        "-y",
        ...inputs,
        // A silent soundtrack: some players and uploads handle a video
        // with an audio track more reliably.
        "-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=44100:cl=stereo",
        "-filter_complex", [...filters, concat].join(";"),
        "-map", "[out]", "-map", `${slides.length}:a`,
        "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "64k", "-shortest",
        "-movflags", "+faststart",
        out,
      ],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
