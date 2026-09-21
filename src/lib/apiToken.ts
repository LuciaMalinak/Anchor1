// Long-lived bearer credentials for the Anchor desktop app (see
// desktop/ at the repo root) — the desktop app has no browser session
// to send cookies with, so it authenticates its API calls with one of
// these instead. Generated once from the Integrations page, shown to
// the user in full exactly once, then only its SHA-256 hash is kept
// (src/db/schema.ts's apiTokens table) — same "never store the secret
// itself" pattern as a password, so a leaked database dump can't be
// turned back into a usable token.
import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { eq } from "drizzle-orm";

const TOKEN_PREFIX = "anchor_desktop_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Returns the plaintext token (to show the user once) and its hash (to
// store). The plaintext is never persisted anywhere after this.
export function generateToken(): { token: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  return { token, hash: hashToken(token) };
}

// Pulls "Bearer <token>" out of an Authorization header and, if it
// matches a live apiTokens row, returns the userId it belongs to (and
// bumps lastUsedAt so the Integrations page can show "last used"). Used
// by every endpoint the desktop app calls instead of session auth.
export async function authenticateBearer(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const hash = hashToken(token);
  const [row] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash));
  if (!row) return null;

  // Constant-time compare isn't actually needed here (the DB lookup
  // above already did an exact-match query on the hash, not the
  // plaintext), but timingSafeEqual is used anyway on the hash bytes as
  // cheap, unambiguous defense-in-depth against any future refactor
  // that compares plaintext tokens directly.
  const rowHashBuf = Buffer.from(row.tokenHash, "hex");
  const hashBuf = Buffer.from(hash, "hex");
  if (rowHashBuf.length !== hashBuf.length || !timingSafeEqual(rowHashBuf, hashBuf)) {
    return null;
  }

  void db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id))
    .then(
      () => {},
      () => {}
    );

  return row.userId;
}
