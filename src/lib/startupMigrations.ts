import { rawClient } from "@/db";

// Small, additive database changes that run automatically every time the
// server starts (see src/instrumentation.ts), so a deploy never needs a
// manual `drizzle-kit push` for them. Each statement is idempotent (IF NOT
// EXISTS), so running it on every start is harmless. Keep this to
// additions only: never drop or rename anything here.
const MIGRATIONS = [
  // Dropbox connections (integration_connection.provider).
  `ALTER TYPE "integration_provider" ADD VALUE IF NOT EXISTS 'dropbox'`,
  // Google Drive / Dropbox document excerpts per deal (dealIntegrationContext.ts).
  `ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "documentContext" text`,
];

export async function runStartupMigrations(): Promise<void> {
  for (const sql of MIGRATIONS) {
    try {
      // One statement per call: ALTER TYPE ... ADD VALUE can't run inside a
      // multi-statement transaction.
      await rawClient.unsafe(sql);
    } catch (err) {
      // Never stop the server from starting over this; the feature that
      // needs the change just won't work until it succeeds.
      console.error(`[startupMigrations] failed: ${sql}`, err);
    }
  }
}
