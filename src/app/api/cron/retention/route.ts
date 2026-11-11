import { NextRequest, NextResponse } from "next/server";
import { purgeExpiredCalls } from "@/lib/retention";

// Automatic deletion of calls older than each team's chosen period
// (src/lib/retention.ts). The server runs it by itself every few hours
// (instrumentation.ts); this route lets an outside scheduler run it too,
// with ?key=CRON_SECRET.
async function handle(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("x-cron-key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(await purgeExpiredCalls());
}

export const GET = handle;
export const POST = handle;
export const maxDuration = 300;
