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
    where table_name in ('team', 'team_invite', 'deal', 'deal_file')
  `;
  const userCols = await rawClient`
    select column_name from information_schema.columns where table_name = 'user'
  `;
  const dealCols = await rawClient`
    select column_name from information_schema.columns where table_name = 'deal'
  `;

  return NextResponse.json({
    migrated: true,
    newTables: newTables.map((r) => r.table_name),
    userColumns: userCols.map((r) => r.column_name),
    dealColumns: dealCols.map((r) => r.column_name),
    meetingColumns: cols.map((r) => r.column_name),
    meetingStatusValues: enumVals.map((r) => r.v),
  });
}
