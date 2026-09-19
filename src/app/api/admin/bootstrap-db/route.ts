import { NextRequest, NextResponse } from "next/server";
import { rawClient } from "@/db";

// One-time migration route: adds the two new per-user dashboard
// personalization columns (colorTheme, dashboardLayout — see the comment
// on the `users` table in schema.ts) to a database that predates them.
// Guarded by a random key baked into the URL rather than auth, since this
// runs before any request-handling code we'd otherwise reuse. Idempotent
// (IF NOT EXISTS) so hitting it twice by accident is harmless. Delete this
// route (and push that deletion) once it's been run successfully against
// production — it has no business staying in the codebase long-term.
const MIGRATION_KEY = "6f6fe005e416c8a379263ad98d1d5cb52f55b072632bbed5";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== MIGRATION_KEY) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await rawClient.unsafe(`
      ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "colorTheme" text;
      ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dashboardLayout" jsonb;
    `);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Migration failed" },
      { status: 500 }
    );
  }
}
