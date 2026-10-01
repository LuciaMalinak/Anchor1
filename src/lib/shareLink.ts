import { createHmac, timingSafeEqual } from "crypto";

// Signed, expiring links to a deal's customer-facing next-steps page
// (/share/<token>). Nothing is stored: the token carries the deal id and
// expiry, signed with AUTH_SECRET, so it can't be guessed or edited.
// Kept free of database imports so scripts/test-next-steps.ts can run it.
const VALID_DAYS = 30;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", `${secret()}:next-steps-share`).update(payload).digest("base64url");
}

export function createShareToken(dealId: string, now = Date.now()): { token: string; expiresAt: Date } {
  const expiresAt = new Date(now + VALID_DAYS * 86_400_000);
  const payload = Buffer.from(`${dealId}.${expiresAt.getTime()}`, "utf8").toString("base64url");
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function readShareToken(token: string, now = Date.now()): { dealId: string; expiresAt: Date } | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const match = decoded.match(/^([0-9a-f-]{36})\.(\d{10,})$/i);
  if (!match) return null;
  const expiresAt = new Date(Number(match[2]));
  if (expiresAt.getTime() < now) return null;
  return { dealId: match[1], expiresAt };
}
