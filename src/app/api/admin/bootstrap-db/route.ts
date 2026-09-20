import { NextRequest, NextResponse } from "next/server";
import { rawClient } from "@/db";

// One-time migration route: adds the new per-user focus-mode column
// (users.focusWidgets — see the comment on the `users` table in
// schema.ts, and src/lib/focusWidgets.ts) to a database that predates it.
// Guarded by a random key baked into the URL rather than auth, since this
// runs before any request-handling code we'd otherwise reuse. Idempotent
// (IF NOT EXISTS) so hitting it twice by accident is harmless. Delete this
// route (and push that deletion) once it's been run successfully against
// production — it has no business staying in the codebase long-term.
const MIGRATION_KEY = "e41ed5d6961741b4ef57a910aba9dd0028c6e4e798ce02ae";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== MIGRATION_KEY) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await rawClient.unsafe(`
      ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "focusWidgets" jsonb;
    `);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Migration failed" },
      { status: 500 }
    );
  }
}
