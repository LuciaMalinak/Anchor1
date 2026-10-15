import { rawClient } from "@/db";
import { BASELINE_STATEMENTS } from "@/db/baseline";

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
  // "Get help" requests with remote screen sharing (support.ts).
  `CREATE TABLE IF NOT EXISTS "support_request" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "message" text NOT NULL,
    "pageUrl" text,
    "accessCode" text,
    "accessCodeAt" timestamp,
    "status" text NOT NULL DEFAULT 'open',
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now(),
    "resolvedAt" timestamp
  )`,
  `CREATE INDEX IF NOT EXISTS "support_request_status_idx" ON "support_request" ("status", "createdAt")`,
  // Morning brief settings and state per person (morningBrief.ts).
  `CREATE TABLE IF NOT EXISTS "morning_brief" (
    "userId" uuid PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
    "enabled" boolean NOT NULL DEFAULT false,
    "prefs" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "lastSentOn" text,
    "shown" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "dismissed" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "lastBrief" jsonb,
    "updatedAt" timestamp NOT NULL DEFAULT now()
  )`,
];

// A brand-new database (say, a replacement for an expired one) has no
// tables at all, which the additions below assume. Create everything in
// one transaction first, so a new DATABASE_URL is the only setup needed.
async function createTablesIfEmpty(): Promise<void> {
  const [{ exists }] = await rawClient<{ exists: boolean }[]>`select to_regclass('public."user"') is not null as exists`;
  if (exists) return;
  console.log(`[startupMigrations] empty database: creating Anchor's tables (${BASELINE_STATEMENTS.length} statements)`);
  await rawClient.begin(async (tx) => {
    for (const sql of BASELINE_STATEMENTS) await tx.unsafe(sql);
  });
  console.log("[startupMigrations] tables created");
}

export async function runStartupMigrations(): Promise<void> {
  try {
    await createTablesIfEmpty();
  } catch (err) {
    console.error("[startupMigrations] couldn't create the tables in an empty database:", err);
  }
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
