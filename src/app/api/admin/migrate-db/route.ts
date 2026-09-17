import { NextRequest, NextResponse } from "next/server";
import { rawClient } from "@/db";

/**
 * ONE-TIME MIGRATION ROUTE — delete this file after using it once.
 *
 * Same reasoning as the earlier /api/admin/bootstrap-db route (removed
 * after use): this sandbox can't reach the production Postgres database
 * directly, only plain HTTPS, so schema changes get applied through a
 * route on the already-deployed app instead of `drizzle-kit push` from a
 * shell. This one adds what the Recall.ai live-meeting feature needs:
 * two new meeting_status values and a recallBotId column. Safe to call
 * more than once (every statement is idempotent).
 */
const MIGRATE_KEY = "2e5772f2114209a83fc75f882480d6a4b0a5c2d9";

const DDL = `
ALTER TYPE meeting_status ADD VALUE IF NOT EXISTS 'joining';
ALTER TYPE meeting_status ADD VALUE IF NOT EXISTS 'recording';
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS "recallBotId" text;

CREATE TABLE IF NOT EXISTS "team" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "teamId" uuid REFERENCES "team"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "team_invite" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "teamId" uuid NOT NULL REFERENCES "team"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "invitedByUserId" uuid NOT NULL REFERENCES "user"("id"),
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "deal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "teamId" uuid NOT NULL REFERENCES "team"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "createdByUserId" uuid NOT NULL REFERENCES "user"("id"),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "meeting" ADD COLUMN IF NOT EXISTS "dealId" uuid REFERENCES "deal"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "deal_file" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dealId" uuid NOT NULL REFERENCES "deal"("id") ON DELETE CASCADE,
  "fileName" text NOT NULL,
  "storagePath" text NOT NULL,
  "fileSize" integer,
  "uploadedByUserId" uuid NOT NULL REFERENCES "user"("id"),
  "createdAt" timestamp NOT NULL DEFAULT now()
);

-- Profiles (personal + deal) and deal-level rolling memory.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "stage" text NOT NULL DEFAULT 'Prospecting';
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "primaryContactName" text;
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "primaryContactRole" text;
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "primaryContactEmail" text;
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "memory" text;
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "companyWebsite" text;

-- Fuller personal profile: contact details and a free-text info box.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "linkedin" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "department" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "otherInfo" text;

-- Manual notes (deal + contact) and on-demand company web research.
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "companyResearch" text;
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "companyResearchUpdatedAt" timestamp;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "notes" text;

-- Recent-news headline, split out of the same company research call.
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "newsHeadline" text;

-- Team-wide daily news briefing (News tab).
ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "dailyBriefing" text;
ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "dailyBriefingUpdatedAt" timestamp;

-- Meeting handoff briefings: reusable decision boundaries per deal.
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "decisionBoundaries" text;

-- Deal-scoped team chat (the Chat tab).
CREATE TABLE IF NOT EXISTS "deal_message" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dealId" uuid NOT NULL REFERENCES "deal"("id") ON DELETE CASCADE,
  "userId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

-- Standing deal lead / backup assignment.
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "leadUserId" uuid REFERENCES "user"("id") ON DELETE SET NULL;
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "backupUserId" uuid REFERENCES "user"("id") ON DELETE SET NULL;

-- Third-party integration connections (Google / Microsoft / Slack OAuth).
DO $$ BEGIN
  CREATE TYPE integration_provider AS ENUM ('google', 'microsoft', 'slack');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "integration_connection" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "provider" integration_provider NOT NULL,
  "externalAccountEmail" text,
  "accessToken" text NOT NULL,
  "refreshToken" text,
  "tokenExpiresAt" timestamp,
  "scope" text,
  "connectedAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_connection_user_provider_idx
  ON "integration_connection" ("userId", "provider");

-- Extracted plain text for deal files, so Ask Anchor can use file
-- contents instead of just filenames.
ALTER TABLE "deal_file" ADD COLUMN IF NOT EXISTS "extractedText" text;

-- Live meeting coaching: real-time transcript segments streamed in from
-- Recall.ai while a bot is on a call, plus the AI-generated live
-- nudges/checklist stored on the meeting itself.
CREATE TABLE IF NOT EXISTS "meeting_live_segment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "meetingId" uuid NOT NULL REFERENCES "meeting"("id") ON DELETE CASCADE,
  "speakerName" text,
  "text" text NOT NULL,
  "relativeSeconds" integer,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
ALTER TABLE "meeting" ADD COLUMN IF NOT EXISTS "liveSuggestions" jsonb;
ALTER TABLE "meeting" ADD COLUMN IF NOT EXISTS "liveSuggestionsUpdatedAt" timestamp;

-- Scheduling a "send Anchor to a live meeting" bot for a future time
-- instead of joining immediately.
ALTER TABLE "meeting" ADD COLUMN IF NOT EXISTS "scheduledAt" timestamp;
`;

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== MIGRATE_KEY) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    await rawClient.unsafe(DDL);
  } catch (err) {
    return NextResponse.json(
      { error: "Migration failed", detail: String(err) },
      { status: 500 },
    );
  }

  const cols = await rawClient`
    select column_name from information_schema.columns where table_name = 'meeting'
  `;
  const enumVals = await rawClient`
    select unnest(enum_range(NULL::meeting_status))::text as v
  `;
  const newTables = await rawClient`
    select table_name from information_schema.tables
    where table_name in ('team', 'team_invite', 'deal', 'deal_file', 'deal_message', 'integration_connection', 'meeting_live_segment')
  `;
  const userCols = await rawClient`
    select column_name from information_schema.columns where table_name = 'user'
  `;
  const dealCols = await rawClient`
    select column_name from information_schema.columns where table_name = 'deal'
  `;
  const contactCols = await rawClient`
    select column_name from information_schema.columns where table_name = 'contact'
  `;
  const dealFileCols = await rawClient`
    select column_name from information_schema.columns where table_name = 'deal_file'
  `;
  const teamCols = await rawClient`
    select column_name from information_schema.columns where table_name = 'team'
  `;

  return NextResponse.json({
    migrated: true,
    newTables: newTables.map((r) => r.table_name),
    userColumns: userCols.map((r) => r.column_name),
    dealColumns: dealCols.map((r) => r.column_name),
    contactColumns: contactCols.map((r) => r.column_name),
    dealFileColumns: dealFileCols.map((r) => r.column_name),
    teamColumns: teamCols.map((r) => r.column_name),
    meetingColumns: cols.map((r) => r.column_name),
    meetingStatusValues: enumVals.map((r) => r.v),
  });
}
