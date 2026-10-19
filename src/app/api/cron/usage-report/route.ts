import { NextRequest, NextResponse } from "next/server";
import { and, gt, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, meetings } from "@/db/schema";
import { ensureAiUsageTable } from "@/lib/aiUsage";

// Where the money goes: AI and transcription spend per feature and model
// over the last ?days= days (default 7), plus hours recorded by Anchor's
// bot and by Anchor Desktop (Recall bills those separately, per hour).
// Totals only — no names or content. Same CRON_SECRET as the hourly job;
// read by .github/workflows/usage-report.yml.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("x-cron-key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 7, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  await ensureAiUsageTable();

  const byFeature = await db
    .select({
      feature: aiUsage.feature,
      provider: aiUsage.provider,
      model: aiUsage.model,
      calls: sql<number>`count(*)::int`,
      costUsd: sql<number>`round(sum(${aiUsage.costUsd})::numeric, 2)::float`,
      inputTokens: sql<number>`sum(${aiUsage.inputTokens})::bigint`,
      cacheReadTokens: sql<number>`sum(${aiUsage.cacheReadTokens})::bigint`,
      outputTokens: sql<number>`sum(${aiUsage.outputTokens})::bigint`,
      webSearches: sql<number>`sum(${aiUsage.webSearches})::int`,
      audioHours: sql<number>`round(sum(${aiUsage.audioSeconds}) / 3600.0, 1)::float`,
    })
    .from(aiUsage)
    .where(gt(aiUsage.createdAt, since))
    .groupBy(aiUsage.feature, aiUsage.provider, aiUsage.model)
    .orderBy(sql`sum(${aiUsage.costUsd}) desc`);

  const [members] = await db
    .select({ members: sql<number>`count(distinct ${aiUsage.userId})::int` })
    .from(aiUsage)
    .where(gt(aiUsage.createdAt, since));

  const recorded = await db
    .select({
      kind: sql<string>`case when ${meetings.recallBotId} is not null then 'bot' when ${meetings.recallRecordingId} is not null then 'desktop' else 'other' end`,
      meetings: sql<number>`count(*)::int`,
      hours: sql<number>`round(coalesce(sum(${meetings.durationSeconds}), 0) / 3600.0, 1)::float`,
    })
    .from(meetings)
    .where(and(gt(meetings.createdAt, since), isNotNull(meetings.createdAt)))
    .groupBy(sql`1`);

  const total = byFeature.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  return NextResponse.json({ days, totalAiUsd: Math.round(total * 100) / 100, members: members?.members ?? 0, byFeature, recorded });
}
