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
  // Every question asked during a call, and the names someone shows up as
  // on calls (liveQuestion.ts, callIdentity.ts).
  `ALTER TABLE "meeting" ADD COLUMN IF NOT EXISTS "liveQuestions" jsonb`,
  `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "callNames" jsonb`,
  `ALTER TABLE "meeting" ADD COLUMN IF NOT EXISTS "stopRequestedAt" timestamp`,
  // What was asked of Ask Anchor during a call (askLog in schema.ts).
  `CREATE TABLE IF NOT EXISTS "ask_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "meetingId" uuid REFERENCES "meeting"("id") ON DELETE SET NULL,
    "dealId" uuid REFERENCES "deal"("id") ON DELETE SET NULL,
    "question" text NOT NULL,
    "answer" text NOT NULL,
    "createdAt" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "ask_log_meetingId_idx" ON "ask_log" ("meetingId", "createdAt")`,
  // Answers Anchor has learned or been taught (answerPlaybook in schema.ts).
  `CREATE TABLE IF NOT EXISTS "answer_playbook" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "teamId" uuid NOT NULL REFERENCES "team"("id") ON DELETE CASCADE,
    "dealId" uuid REFERENCES "deal"("id") ON DELETE CASCADE,
    "question" text NOT NULL,
    "answer" text NOT NULL,
    "source" text NOT NULL,
    "meetingId" uuid REFERENCES "meeting"("id") ON DELETE SET NULL,
    "userId" uuid REFERENCES "user"("id") ON DELETE SET NULL,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "answer_playbook_teamId_idx" ON "answer_playbook" ("teamId", "updatedAt")`,
  // Feedback on Anchor after each call (callFeedback in schema.ts).
  `ALTER TABLE "meeting" ADD COLUMN IF NOT EXISTS "callFeedback" jsonb`,
  // Desktop app version per token (apiTokens in schema.ts).
  `ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "clientVersion" text`,
  `ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "clientPlatform" text`,
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
