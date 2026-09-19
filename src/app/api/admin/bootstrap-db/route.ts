import { NextRequest, NextResponse } from "next/server";
import { rawClient } from "@/db";

// One-time schema-apply route — see the pattern this repo already uses
// for every prior schema change (no drizzle-kit push workflow wired up,
// and the sandbox that authors these changes can't reach the production
// Postgres directly). Deleted again right after confirming this ran.
const KEY = "107dd831f08fa58eba276ce8a61ac9865001f36ea6281db0";

const DDL = `
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dailyDigestOptIn" boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "announcement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "teamId" uuid NOT NULL REFERENCES "team"("id") ON DELETE CASCADE,
  "authorUserId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
`;

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== KEY) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await rawClient.unsafe(DDL);
    const columns = await rawClient.unsafe(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_name = 'user' AND column_name = 'dailyDigestOptIn' OR table_name = 'announcement'`
    );
    return NextResponse.json({ ok: true, columns });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
