// Draws every Anchor icon from the one logo below, so the website, the
// browser tab, emails, the desktop app and its tray icon always match
// (and match the LinkedIn Page). Run after changing the logo:
//
//   node scripts/generate-brand-assets.mjs
//
// The same shapes are inlined in src/components/Logo.tsx (AnchorMark) and
// desktop/src/renderer/index.html: keep all three in sync.
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const NAVY = "#12294A";
const COPPER = "#B4531F";
const WHITE = "#FFFFFF";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// The anchor in a 512×512 box: copper ring, then shank, stock, arms, flukes.
export function mark({ body = NAVY, ring = COPPER } = {}) {
  return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="256" cy="92" r="38" stroke="${ring}" stroke-width="28"/>
    <line x1="256" y1="160" x2="256" y2="430" stroke="${body}" stroke-width="34"/>
    <line x1="164" y1="196" x2="348" y2="196" stroke="${body}" stroke-width="34"/>
    <path d="M104 300 C 112 392 180 446 256 446 C 332 446 400 392 408 300" stroke="${body}" stroke-width="34"/>
  </g>
  <g fill="${body}">
    <path d="M70 318 L104 252 L140 318 Z"/>
    <path d="M372 318 L408 252 L442 318 Z"/>
  </g>`;
}

// size: output pixels. tile: a background square (with corner radius as a
// share of the size) or none. pad: empty space around the anchor.
function svg(size, { tile, radius = 0, inset = 0, pad, body, ring }) {
  const s = 512;
  const box = s - inset * 2;
  const inner = box * (1 - pad * 2);
  const off = inset + box * pad;
  const bg = tile
    ? `<rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${box * radius}" fill="${tile}"/>`
    : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">${bg}<g transform="translate(${off} ${off}) scale(${inner / s})">${mark({ body, ring })}</g></svg>`,
  );
}

const png = (size, opts) => sharp(svg(size, opts)).png().toBuffer();

// Navy tile with a white anchor: the app icon look.
const tileIcon = (size, radius = 0.22) => png(size, { tile: NAVY, radius, pad: 0.16, body: WHITE, ring: COPPER });

// .ico: a directory of PNG images (Windows Vista+ reads PNG entries).
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

// .icns: PNG-backed entries (macOS 10.7+).
function icns(entries) {
  const parts = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

async function write(rel, data) {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  console.log("wrote", rel);
}

// Website: browser tab, home-screen icon, email header.
await write("src/app/icon.png", await tileIcon(512));
await write("src/app/apple-icon.png", await png(180, { tile: NAVY, pad: 0.16, body: WHITE, ring: COPPER }));
await write(
  "src/app/favicon.ico",
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await tileIcon(size, 0.2) })))),
);
await write("public/email-logo.png", await tileIcon(128));
await write("public/brand/anchor-mark.svg", svg(512, { pad: 0.04, body: NAVY, ring: COPPER }));

// Desktop app icon. macOS: the standard rounded tile with margin inside a
// 1024 canvas. Windows: a full tile.
const macIcon = (size) => png(size, { tile: NAVY, radius: 0.225, inset: 50, pad: 0.16, body: WHITE, ring: COPPER });
await write(
  "desktop/build/icon.icns",
  icns(
    await Promise.all(
      [
        ["icp4", 16],
        ["icp5", 32],
        ["icp6", 64],
        ["ic07", 128],
        ["ic08", 256],
        ["ic09", 512],
        ["ic10", 1024],
      ].map(async ([type, size]) => ({ type, data: await macIcon(size) })),
    ),
  ),
);
await write(
  "desktop/build/icon.ico",
  ico(await Promise.all([16, 24, 32, 48, 64, 128, 256].map(async (size) => ({ size, data: await tileIcon(size, 0.2) })))),
);

// Tray icons. macOS: a black glyph it tints itself. Windows: the tile.
for (const [suffix, size] of [["", 16], ["@2x", 32], ["@3x", 48]]) {
  await write(
    `desktop/src/renderer/icons/trayTemplate${suffix}.png`,
    await png(size, { pad: 0.02, body: "#000000", ring: "#000000" }),
  );
}
for (const [suffix, size] of [["", 16], ["@1.5x", 24], ["@2x", 32], ["@3x", 48]]) {
  await write(`desktop/src/renderer/icons/trayWindows${suffix}.png`, await tileIcon(size, 0.2));
}
