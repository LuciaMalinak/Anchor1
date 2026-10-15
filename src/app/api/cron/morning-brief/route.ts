import { NextRequest, NextResponse } from "next/server";
import { runDueMorningBriefs } from "@/lib/morningBrief";

// The hourly Morning brief job: sends everyone whose chosen time has come
// (in their own time zone) and who hasn't had today's yet. Called every
// hour by .github/workflows/morning-brief.yml with ?key=CRON_SECRET; this
// app has no scheduler of its own. Safe to call more often or twice: each
// person gets at most one brief a day.
async function handle(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("x-cron-key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const summary = await runDueMorningBriefs();
  return NextResponse.json({ ok: true, ...summary });
}

export const GET = handle;
export const POST = handle;
// Several briefs (each with AI calls) can run in one request.
export const maxDuration = 300;
