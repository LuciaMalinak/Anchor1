import { rawClient } from "@/db";
import { BASELINE_STATEMENTS } from "@/db/baseline";

// Small, additive database changes that run automatically every time the
// server starts (see src/instrumentation.ts), so a deploy never needs a
// manual `drizzle-kit push` for them. Each statement is idempotent (IF NOT
// EXISTS), so running it on every start is harmless. Keep this to
// additions only: never drop or rename anything here.
const MIGRATIONS = [
  // Two-step verification (src/lib/auth/twoFactor.ts).
  `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "twoFactorSecret" text`,
  `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "twoFactorEnabledAt" timestamp`,
  `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "twoFactorRecoveryHashes" jsonb`,
  `ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "twoFactorVerifiedAt" timestamp`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "requireTwoFactor" boolean NOT NULL DEFAULT false`,
  // Failed password sign-ins, for the lockout in src/lib/auth/signInLimit.ts.
  `CREATE TABLE IF NOT EXISTS "sign_in_failure" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" text NOT NULL,
    "ip" text,
    "createdAt" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "sign_in_failure_email_idx" ON "sign_in_failure" ("email", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "sign_in_failure_ip_idx" ON "sign_in_failure" ("ip", "createdAt")`,
  // Record of deleted deals, removed people and moved accounts
  // (src/lib/dataChangeLog.ts).
  `CREATE TABLE IF NOT EXISTS "data_change_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "action" text NOT NULL,
    "actorUserId" uuid,
    "actorEmail" text,
    "teamId" uuid,
    "targetId" uuid,
    "details" jsonb,
    "createdAt" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "data_change_log_target_idx" ON "data_change_log" ("targetId")`,
  `CREATE INDEX IF NOT EXISTS "data_change_log_created_idx" ON "data_change_log" ("createdAt")`,
  // Billing (src/lib/billing.ts). billingExempt is added without a
  // default first, so every team that already exists when billing
  // arrives is marked free (they were using Anchor before it was paid);
  // the default for new teams is then false.
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "billingExempt" boolean`,
  `UPDATE "team" SET "billingExempt" = true WHERE "billingExempt" IS NULL`,
  `ALTER TABLE "team" ALTER COLUMN "billingExempt" SET DEFAULT false`,
  `ALTER TABLE "team" ALTER COLUMN "billingExempt" SET NOT NULL`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "billingStatus" text`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "billingPlan" text`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "billingSeats" integer`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "stripeCustomerId" text`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" text`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "trialEndsAt" timestamp`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" timestamp`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "promoCodeUsed" text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "team_stripeSubscriptionId_idx" ON "team" ("stripeSubscriptionId")`,
  `CREATE TABLE IF NOT EXISTS "promo_code" (
    "code" text PRIMARY KEY,
    "trialDays" integer NOT NULL,
    "maxUses" integer,
    "uses" integer NOT NULL DEFAULT 0,
    "active" boolean NOT NULL DEFAULT true,
    "expiresAt" timestamp,
    "note" text,
    "createdAt" timestamp NOT NULL DEFAULT now()
  )`,
  // The public 1-week free trial code used on /free-trial and in the
  // LinkedIn campaign. Created once; turn it off or change it in Admin →
  // Billing (this never overwrites it).
  `INSERT INTO "promo_code" ("code", "trialDays", "maxUses", "note")
    VALUES ('TRYANCHOR', 7, NULL, 'Public 1-week free trial (website /free-trial and LinkedIn)')
    ON CONFLICT ("code") DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS "sales_lead" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "email" text NOT NULL,
    "company" text,
    "teamSize" text,
    "message" text,
    "userId" uuid REFERENCES "user"("id") ON DELETE SET NULL,
    "status" text NOT NULL DEFAULT 'new',
    "createdAt" timestamp NOT NULL DEFAULT now()
  )`,
  // The LinkedIn bot for the company Page (src/lib/linkedinBot/).
  `CREATE TABLE IF NOT EXISTS "linkedin_bot" (
    "id" text PRIMARY KEY,
    "orgUrn" text,
    "orgName" text,
    "accessToken" text,
    "refreshToken" text,
    "tokenExpiresAt" timestamp,
    "refreshExpiresAt" timestamp,
    "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "lastPlannedOn" text,
    "engagement" jsonb,
    "lastError" text,
    "updatedAt" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "linkedin_bot_item" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "kind" text NOT NULL,
    "status" text NOT NULL,
    "scheduledFor" timestamp,
    "topic" text,
    "text" text NOT NULL,
    "extra" jsonb,
    "linkedinUrn" text,
    "error" text,
    "attempts" integer NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "postedAt" timestamp
  )`,
  `CREATE INDEX IF NOT EXISTS "linkedin_bot_item_status_idx" ON "linkedin_bot_item" ("status", "scheduledFor")`,
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
  // Industry deal sheet and rule flags per call summary (industryPlaybooks.ts).
  `ALTER TABLE "summary" ADD COLUMN IF NOT EXISTS "industryFacts" jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE "summary" ADD COLUMN IF NOT EXISTS "complianceFlags" jsonb NOT NULL DEFAULT '[]'::jsonb`,
  // Latest industry tool report per tool on each deal (industryTools.ts).
  `ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "toolReports" jsonb`,
  // Morning brief switched off by the person themselves (morningBriefPrefs.ts).
  `ALTER TABLE "morning_brief" ADD COLUMN IF NOT EXISTS "turnedOffAt" timestamp`,
  `ALTER TABLE "morning_brief" ADD COLUMN IF NOT EXISTS "timeZoneGuessed" boolean NOT NULL DEFAULT false`,
  // What happened to the last scheduled brief (morningBrief.ts).
  `ALTER TABLE "morning_brief" ADD COLUMN IF NOT EXISTS "lastResult" jsonb`,
  // Zoom connections, Slack user tokens, and meetings to set up from email
  // and Slack (meetingProposals.ts, meetingScheduler.ts).
  `ALTER TYPE "integration_provider" ADD VALUE IF NOT EXISTS 'zoom'`,
  `ALTER TABLE "integration_connection" ADD COLUMN IF NOT EXISTS "userAccessToken" text`,
  `ALTER TABLE "integration_connection" ADD COLUMN IF NOT EXISTS "externalAccountId" text`,
  `CREATE TABLE IF NOT EXISTS "meeting_proposal" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "source" text NOT NULL,
    "sourceKey" text NOT NULL,
    "sourceUrl" text,
    "fromName" text NOT NULL,
    "title" text NOT NULL,
    "reason" text NOT NULL,
    "start" text,
    "durationMinutes" integer NOT NULL DEFAULT 30,
    "timeZone" text NOT NULL,
    "attendees" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "status" text NOT NULL DEFAULT 'open',
    "result" jsonb,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "meeting_proposal_source_idx" ON "meeting_proposal" ("userId", "source", "sourceKey")`,
  // A team's own specialty: playbook and tools from its website (teamSpecialty.ts).
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "specialty" jsonb`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "companyWebsite" text`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "companyContext" text`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "specialtyStatus" text`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "specialtyRequestedAt" timestamp`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "specialtyError" text`,
  // Ask Anchor learning (src/lib/askMemory.ts).
  `ALTER TABLE "ask_log" ADD COLUMN IF NOT EXISTS "rating" integer`,
  `ALTER TABLE "ask_log" ADD COLUMN IF NOT EXISTS "feedbackNote" text`,
  `CREATE TABLE IF NOT EXISTS "ask_memory" (
    "userId" uuid PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
    "notes" text NOT NULL DEFAULT '',
    "asksSinceUpdate" integer NOT NULL DEFAULT 0,
    "updatedAt" timestamp NOT NULL DEFAULT now()
  )`,
  // Returning accounts (src/lib/accountReturn.ts).
  `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "deletedEmailHash" text`,
  `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "deletedAt" timestamp`,
  `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "deletedOwnedTeamId" uuid`,
  `CREATE INDEX IF NOT EXISTS "user_deletedEmailHash_idx" ON "user" ("deletedEmailHash")`,
  // Enterprise controls: automatic deletion, do-not-record list and the
  // team's activity log (retention.ts, doNotRecord.ts, activityLog.ts).
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "retentionDays" integer`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "doNotRecord" jsonb`,
  `CREATE INDEX IF NOT EXISTS "data_change_log_team_idx" ON "data_change_log" ("teamId", "createdAt")`,
  // Subscription changes from inside Anchor (billing.ts manageSubscription).
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "billingCancelAt" timestamp`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "billingPausedAt" timestamp`,
  `ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "billingResumesAt" timestamp`,
];

// A brand-new database (say, a replacement for an expired one) has no
// tables at all, which the additions below assume. Create everything in
// one transaction first, so a new DATABASE_URL is the only setup needed.
async function createTablesIfEmpty(): Promise<void> {
  const [{ exists }] = await rawClient<{ exists: boolean }[]>`select to_regclass('public."user"') is not null as exists`;
  if (exists) return;
  console.log(`[startupMigrations] empty database: creating Anchor.AI's tables (${BASELINE_STATEMENTS.length} statements)`);
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
