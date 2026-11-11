import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { teamOwnerContext } from "@/lib/teamOwner";
import { activityCsv, logTeamActivity, teamActivity } from "@/lib/activityLog";
import { cleanDoNotRecord } from "@/lib/doNotRecord";
import { RETENTION_CHOICES } from "@/lib/retention";

// Team owner's enterprise controls on the Team page: automatic deletion
// of old calls, the do-not-record list, and the team's activity log
// (?format=csv downloads the log).
export async function GET(req: NextRequest) {
  const ctx = await teamOwnerContext();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (req.nextUrl.searchParams.get("format") === "csv") {
    const rows = await teamActivity(ctx.team.id, 5000);
    return new NextResponse(activityCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="anchor-activity-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  return NextResponse.json({
    retentionDays: ctx.team.retentionDays ?? null,
    retentionChoices: RETENTION_CHOICES,
    doNotRecord: cleanDoNotRecord(ctx.team.doNotRecord),
    activity: await teamActivity(ctx.team.id, 200),
  });
}

export async function PUT(req: NextRequest) {
  const ctx = await teamOwnerContext();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const body = (await req.json().catch(() => ({}))) as { retentionDays?: number | null; doNotRecord?: unknown };
  const update: { retentionDays?: number | null; doNotRecord?: string[] } = {};

  if ("retentionDays" in body) {
    const days = body.retentionDays;
    if (days !== null && !(RETENTION_CHOICES as readonly number[]).includes(Number(days))) {
      return NextResponse.json({ error: "Choose one of the listed periods." }, { status: 400 });
    }
    update.retentionDays = days === null ? null : Number(days);
  }
  if ("doNotRecord" in body) update.doNotRecord = cleanDoNotRecord(body.doNotRecord);
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  await db.update(teams).set(update).where(eq(teams.id, ctx.team.id));
  if ("retentionDays" in update && update.retentionDays !== (ctx.team.retentionDays ?? null)) {
    await logTeamActivity(ctx.user.id, "retention_changed", null, { days: update.retentionDays ?? "keep until deleted" });
  }
  if (update.doNotRecord) {
    await logTeamActivity(ctx.user.id, "do_not_record_changed", null, { entries: update.doNotRecord });
  }
  return NextResponse.json({ ok: true, ...update });
}
