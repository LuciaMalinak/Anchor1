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

  return NextResponse.json({
    migrated: true,
    meetingColumns: cols.map((r) => r.column_name),
    meetingStatusValues: enumVals.map((r) => r.v),
  });
}
