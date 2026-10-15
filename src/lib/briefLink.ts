import { createHmac, timingSafeEqual } from "crypto";

// Signed, expiring links to a person's Morning brief page (/brief/<token>),
// sent only to them by email, text or Slack, so it opens on a phone
// without signing in. Same scheme as shareLink.ts, with its own key so a
// share-link token can never open a brief. Kept free of database imports
// so scripts/test-next-steps.ts can run it.
const VALID_DAYS = 3;

function sign(payload: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", `${secret}:morning-brief`).update(payload).digest("base64url");
}

export function createBriefToken(userId: string, now = Date.now()): string {
  const payload = Buffer.from(`${userId}.${now + VALID_DAYS * 86_400_000}`, "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readBriefToken(token: string, now = Date.now()): { userId: string } | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const match = Buffer.from(payload, "base64url").toString("utf8").match(/^([0-9a-f-]{36})\.(\d{10,})$/i);
  if (!match || Number(match[2]) < now) return null;
  return { userId: match[1] };
}
