import { NextRequest, NextResponse } from "next/server";
import { runDueMorningBriefs } from "@/lib/morningBrief";
import { reconcileStaleBotMeetings } from "@/lib/botReconcile";

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
  // Also catches up any bot call still shown as live long after it should
  // have ended (its "recording done" webhook never came).
  const staleCalls = await reconcileStaleBotMeetings().catch((err) => {
    console.error("[cron] catching up stale calls failed:", err);
    return -1;
  });
  const summary = await runDueMorningBriefs();
  return NextResponse.json({ ok: true, staleCalls, ...summary });
}

export const GET = handle;
export const POST = handle;
// Several briefs (each with AI calls) can run in one request.
export const maxDuration = 300;
