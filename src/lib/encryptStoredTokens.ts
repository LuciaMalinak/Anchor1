import { rawClient } from "@/db";
import { decryptToken, encryptToken, needsReencrypt } from "@/lib/tokenCrypto";

// Run once at each start (src/instrumentation.ts): encrypts any connected-
// tool token still stored as plain text (saved before encryption existed),
// and re-encrypts any saved under an older key. Each update only applies if
// the value hasn't changed since it was read, so a token refreshed at the
// same moment is never overwritten. These tables are small (one row per
// connection), so reading them whole is fine.

const TARGETS: { table: string; key: string[]; columns: string[] }[] = [
  { table: "integration_connection", key: ["id"], columns: ["accessToken", "refreshToken", "userAccessToken"] },
  { table: "linkedin_bot", key: ["id"], columns: ["accessToken", "refreshToken"] },
];

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function encryptStoredTokens(): Promise<void> {
  let changed = 0;
  for (const { table, key, columns } of TARGETS) {
    for (const column of columns) {
      try {
        const rows = await rawClient.unsafe(
          `select ${key.map(quote).join(", ")}, ${quote(column)} as v from ${quote(table)} where ${quote(column)} is not null`
        );
        for (const row of rows) {
          const stored = row.v as string;
          if (!needsReencrypt(stored)) continue;
          const next = encryptToken(decryptToken(stored));
          if (next === stored) continue;
          const where = key.map((k, i) => `${quote(k)} = $${i + 3}`).join(" and ");
          const res = await rawClient.unsafe(
            `update ${quote(table)} set ${quote(column)} = $1 where ${quote(column)} = $2 and ${where}`,
            [next, stored, ...key.map((k) => String(row[k]))]
          );
          changed += res.count;
        }
      } catch (err) {
        // A table that doesn't exist yet (fresh database) is fine.
        console.error(`[encryptStoredTokens] ${table}.${column}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  if (changed) console.log(`[encryptStoredTokens] encrypted ${changed} stored token(s)`);
}
