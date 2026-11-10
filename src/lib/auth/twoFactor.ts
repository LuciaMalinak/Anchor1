import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, teams, users } from "@/db/schema";

// Two-step verification with an authenticator app (Google Authenticator,
// Microsoft Authenticator, 1Password, …): standard TOTP (RFC 6238, 6
// digits, 30-second steps, SHA-1), plus one-time recovery codes for a lost
// phone. Turned on from Profile; a team owner can require it for the whole
// team. Enforced in two places: src/proxy.ts sends a sign-in that hasn't
// passed it to /sign-in/two-factor, and the session callback in
// src/auth.ts withholds the signed-in user from every page and API until
// it has.

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const ISSUER = "Anchor.AI";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

function codeAt(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const bin = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return bin.toString().padStart(6, "0");
}

// Accepts the code for now and one step either side (phone clocks drift).
export function verifyCode(secret: string, code: string, now = Date.now()): boolean {
  const digits = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(digits)) return false;
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  for (const c of [counter - 1, counter, counter + 1]) {
    const expected = Buffer.from(codeAt(secret, c));
    if (timingSafeEqual(expected, Buffer.from(digits))) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, account: string): string {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

const hashRecovery = (code: string) =>
  createHash("sha256").update(code.toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");

// Ten one-time codes like "k7m2-9xqp". Shown once; only hashes are kept.
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes = Array.from({ length: 10 }, () => {
    const bytes = randomBytes(8);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashRecovery) };
}

// Uses up a recovery code: returns the remaining hashes, or null if the
// code doesn't match any.
export function spendRecoveryCode(hashes: string[] | null | undefined, code: string): string[] | null {
  if (!hashes?.length) return null;
  const h = hashRecovery(code);
  if (!hashes.includes(h)) return null;
  return hashes.filter((x) => x !== h);
}

// The sign-in behind a session cookie, read straight from the database
// (auth() hides the user until two-step verification is done, so pages
// that handle that step can't use it).
export async function sessionWithUser(token: string | undefined) {
  if (!token) return null;
  const [row] = await db
    .select({ session: sessions, user: users, requireTwoFactor: teams.requireTwoFactor })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(teams, eq(teams.id, users.teamId))
    .where(eq(sessions.sessionToken, token))
    .limit(1);
  if (!row || row.session.expires.getTime() < Date.now()) return null;
  return row;
}

export function needsSecondStep(user: { twoFactorEnabledAt: Date | null }, session: { twoFactorVerifiedAt: Date | null }) {
  return Boolean(user.twoFactorEnabledAt) && !session.twoFactorVerifiedAt;
}

export async function markSessionVerified(token: string) {
  await db.update(sessions).set({ twoFactorVerifiedAt: new Date() }).where(eq(sessions.sessionToken, token));
}

// For pages outside /dashboard (which src/proxy.ts doesn't cover) that
// send signed-out visitors to /sign-in: a sign-in that's only waiting for
// its code goes to the code page instead, then comes back to `next`.
export async function secondStepPath(next: string): Promise<string | null> {
  const { cookies } = await import("next/headers");
  const { sessionCookieName } = await import("@/lib/auth/password");
  const row = await sessionWithUser((await cookies()).get(sessionCookieName())?.value);
  if (!row || !needsSecondStep(row.user, row.session)) return null;
  return `/sign-in/two-factor?next=${encodeURIComponent(next)}`;
}
