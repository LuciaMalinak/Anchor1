import { NextRequest, NextResponse } from "next/server";
import { rawClient } from "@/db";

// One-time migration route — same pattern used before (see git history):
// hit once via a fresh, unauthenticated tab right after deploy, confirm
// the JSON response, then delete this file and push the cleanup commit.
// Fresh random key each time this pattern is reused, never a reused one.
const KEY = "5436294e549a0132dd9046aa765c5a0f03e811c7cb750268";

const DDL = `
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "linkedinUrl" text;
`;

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== KEY) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await rawClient.unsafe(DDL);
    return NextResponse.json({ ok: true, ran: DDL.trim() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
