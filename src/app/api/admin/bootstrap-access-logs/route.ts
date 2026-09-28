import { NextRequest, NextResponse } from "next/server";
import { rawClient } from "@/db";

// One-time migration route: creates the admin_access_log table (see the
// comment on adminAccessLogs in schema.ts) on a database that predates it.
// Same pattern as bootstrap-db/route.ts — guarded by a random key baked
// into the URL rather than session auth, since this has to work before the
// table it's creating even exists. Idempotent (IF NOT EXISTS everywhere) so
// hitting it twice by accident is harmless. Delete this route (and push
// that deletion) once it's been run successfully against production.
const MIGRATION_KEY = "f2a9c7e1b6d84a3f9012e7c5b3a6d1f8e4c9b2a705d3e816";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== MIGRATION_KEY) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await rawClient.unsafe(`
      CREATE TABLE IF NOT EXISTS "admin_access_log" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "adminUserId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "targetTeamId" uuid NOT NULL REFERENCES "team"("id") ON DELETE CASCADE,
        "view" text NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      );
    `);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Migration failed" },
      { status: 500 }
    );
  }
}
