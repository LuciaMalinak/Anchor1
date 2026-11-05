import { NextRequest, NextResponse } from "next/server";
import { runLinkedInBot } from "@/lib/linkedinBot/run";

// Backup trigger for the LinkedIn bot (the server also runs it every few
// minutes by itself, see instrumentation.ts): writes today's posts if they
// aren't written yet and publishes any that are due. Call with
// ?key=CRON_SECRET; safe to call as often as you like.
async function handle(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("x-cron-key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...(await runLinkedInBot()) });
}

export const GET = handle;
export const POST = handle;
export const maxDuration = 300;
