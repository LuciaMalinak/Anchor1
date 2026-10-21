import { NextRequest, NextResponse } from "next/server";
import { runDueMorningBriefs } from "@/lib/morningBrief";
import { recoverStuckMeetings } from "@/lib/stuckMeetings";

// Sends everyone whose Morning brief time has come (in their own time
// zone) and who hasn't had today's yet. The server already checks every
// five minutes by itself (instrumentation.ts); this route is the backup
// that .github/workflows/morning-brief.yml (or any outside scheduler)
// calls with ?key=CRON_SECRET, and it wakes a sleeping server. Safe to
// call more often or twice: each person gets at most one brief a day.
async function handle(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("x-cron-key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Also finishes any meeting stuck on Home (stuckMeetings.ts) — the
  // server runs this itself every few minutes too.
  const staleCalls = await recoverStuckMeetings().catch((err) => {
    console.error("[cron] recovering stuck meetings failed:", err);
    return null;
  });
  const summary = await runDueMorningBriefs();
  return NextResponse.json({ ok: true, staleCalls, ...summary });
}

export const GET = handle;
export const POST = handle;
// Several briefs (each with AI calls) can run in one request.
export const maxDuration = 300;
