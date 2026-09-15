import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { rawClient } from "@/db";

/**
 * ONE-TIME SETUP ROUTE — delete this file after using it once.
 *
 * Normally the production database's tables get created by running
 * `npx drizzle-kit push` against DATABASE_URL from a real shell. This
 * project's hosting sandbox couldn't reach Postgres directly (only plain
 * HTTPS), so instead this route runs the same table-creation SQL from
 * inside the already-deployed app, which *can* reach its own database.
 *
 * It's guarded by a one-time secret (not anything already in .env) and is
 * safe to call more than once — it checks whether the tables already
 * exist and does nothing if so.
 */
const SETUP_KEY = "6440aa9529d2869c2be6b260fff3550f8b092d7c";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== SETUP_KEY) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const existing = await rawClient`
    select table_name from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `;

  if (existing.length > 0) {
    return NextResponse.json({
      alreadyInitialized: true,
      tables: existing.map((r) => r.table_name),
    });
  }

  const sqlPath = path.join(process.cwd(), "src/db/bootstrap-schema.sql");
  const ddl = fs.readFileSync(sqlPath, "utf-8");

  try {
    await rawClient.unsafe(ddl);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to run schema DDL", detail: String(err) },
      { status: 500 },
    );
  }

  const after = await rawClient`
    select table_name from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `;

  return NextResponse.json({
    created: true,
    tables: after.map((r) => r.table_name),
  });
}
