import crypto from "crypto";

// Public links to a weekly video and its cover image, for Zapier to fetch
// when it posts. Each link carries a signature made with AUTH_SECRET, so
// only items the bot sent out can be opened, and only by whoever has the
// exact link.
function signature(id: string): string {
  const secret = process.env.AUTH_SECRET || process.env.CRON_SECRET || "";
  return crypto.createHmac("sha256", `linkedin-media:${secret}`).update(id).digest("hex").slice(0, 32);
}

export function mediaFileName(id: string, ext: "mp4" | "png"): string {
  return `${id}-${signature(id)}.${ext}`;
}

export function mediaUrl(id: string, ext: "mp4" | "png"): string | null {
  const base = process.env.AUTH_URL;
  return base ? `${base.replace(/\/$/, "")}/api/linkedin-bot/media/${mediaFileName(id, ext)}` : null;
}

// Back from a file name to the item id, if its signature is right.
export function parseMediaFile(file: string): { id: string; ext: "mp4" | "png" } | null {
  const m = /^([0-9a-f-]{36})-([0-9a-f]{32})\.(mp4|png)$/.exec(file);
  if (!m) return null;
  const expected = signature(m[1]);
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]))) return null;
  return { id: m[1], ext: m[3] as "mp4" | "png" };
}
