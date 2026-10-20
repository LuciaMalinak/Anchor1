import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiUsage,
  apiTokens,
  answerPlaybook,
  deals,
  integrationConnections,
  meetingLiveSegments,
  meetings,
  morningBriefs,
  summaries,
  tasks,
  transcripts,
  userStyleProfiles,
  users,
} from "@/db/schema";

// A health check of one person's Anchor, for support: is their account,
// desktop app, Google connection, morning brief and recent meetings all
// working? ?q= matches name or email. Statuses, counts, dates and error
// messages only — no meeting titles, transcripts or email content, and
// the email is masked. Same CRON_SECRET as the hourly job; read by
// .github/workflows/user-health.yml.
const STUCK_LIVE_MS = 3 * 60 * 60_000;
const STUCK_PROCESSING_MS = 30 * 60_000;
const RECENT_MEETINGS = 15;

function mask(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}***@${domain ?? ""}`;
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("x-cron-key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 3) return NextResponse.json({ error: "q needs at least 3 characters" }, { status: 400 });

  const people = await db
    .select()
    .from(users)
    .where(or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)))
    .limit(5);

  const now = Date.now();
  const report = [];
  for (const u of people) {
    const [tokens, connections, brief, recent, style, ledDeals, openTasks, usage, playbook] = await Promise.all([
      db.select().from(apiTokens).where(eq(apiTokens.userId, u.id)).orderBy(desc(apiTokens.lastUsedAt)),
      db
        .select({ provider: integrationConnections.provider, scope: integrationConnections.scope, hasRefresh: sql<boolean>`${integrationConnections.refreshToken} is not null`, expires: integrationConnections.tokenExpiresAt })
        .from(integrationConnections)
        .where(eq(integrationConnections.userId, u.id)),
      db.select().from(morningBriefs).where(eq(morningBriefs.userId, u.id)),
      db.select().from(meetings).where(eq(meetings.userId, u.id)).orderBy(desc(meetings.createdAt)).limit(RECENT_MEETINGS),
      db.select().from(userStyleProfiles).where(eq(userStyleProfiles.userId, u.id)),
      db.select({ n: sql<number>`count(*)::int` }).from(deals).where(eq(deals.leadUserId, u.id)),
      u.teamId
        ? db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.teamId, u.teamId), eq(tasks.completed, false)))
        : Promise.resolve([{ n: 0 }]),
      db
        .select({ feature: aiUsage.feature, calls: sql<number>`count(*)::int`, costUsd: sql<number>`round(sum(${aiUsage.costUsd})::numeric, 3)::float` })
        .from(aiUsage)
        .where(and(eq(aiUsage.userId, u.id), gt(aiUsage.createdAt, new Date(now - 7 * 86_400_000))))
        .groupBy(aiUsage.feature),
      u.teamId
        ? db.select({ source: answerPlaybook.source, n: sql<number>`count(*)::int` }).from(answerPlaybook).where(eq(answerPlaybook.teamId, u.teamId)).groupBy(answerPlaybook.source)
        : Promise.resolve([]),
    ]);

    const ids = recent.map((m) => m.id);
    const [segCounts, transcriptRows, summaryRows] = ids.length
      ? await Promise.all([
          db
            .select({ id: meetingLiveSegments.meetingId, n: sql<number>`count(*)::int` })
            .from(meetingLiveSegments)
            .where(inArray(meetingLiveSegments.meetingId, ids))
            .groupBy(meetingLiveSegments.meetingId),
          db.select({ id: transcripts.meetingId, provider: transcripts.provider }).from(transcripts).where(inArray(transcripts.meetingId, ids)),
          db.select({ id: summaries.meetingId }).from(summaries).where(inArray(summaries.meetingId, ids)),
        ])
      : [[], [], []];
    const segs = new Map(segCounts.map((s) => [s.id, s.n]));
    const provider = new Map(transcriptRows.map((t) => [t.id, t.provider]));
    const summarized = new Set(summaryRows.map((s) => s.id));

    const meetingRows = recent.map((m) => {
      const age = now - m.updatedAt.getTime();
      const live = m.status === "joining" || m.status === "recording";
      const processing = m.status === "uploaded" || m.status === "transcribing" || m.status === "summarizing";
      const problems: string[] = [];
      if (live && age > STUCK_LIVE_MS) problems.push("live for hours with no update");
      if (processing && age > STUCK_PROCESSING_MS) problems.push(`stuck in ${m.status}`);
      if (m.status === "failed") problems.push(`failed: ${m.errorMessage ?? "no reason saved"}`);
      if (m.status === "ready" && !summarized.has(m.id)) problems.push("ready but no summary");
      if (m.status === "ready" && !m.dealId) problems.push("not on a deal");
      return {
        created: m.createdAt.toISOString().slice(0, 16),
        kind: m.recallBotId ? "bot" : m.recallRecordingId ? "desktop" : m.audioStoragePath ? "upload/mic" : "mic",
        status: m.status,
        minutes: m.durationSeconds ? Math.round(m.durationSeconds / 60) : null,
        liveLines: segs.get(m.id) ?? 0,
        liveAnswers: (m.liveQuestions ?? []).length,
        transcript: provider.get(m.id) ?? null,
        audio: Boolean(m.audioStoragePath),
        feedback: m.callFeedback ? (m.callFeedback.skipped ? "skipped" : m.callFeedback.rating ?? "note") : null,
        problems,
      };
    });

    const google = connections.find((c) => c.provider === "google");
    report.push({
      user: {
        name: u.name,
        email: mask(u.email),
        joined: u.createdAt?.toISOString?.().slice(0, 10) ?? null,
        onTeam: Boolean(u.teamId),
        restrictedToDeals: u.restrictedToDeals ?? false,
        callNames: (u.callNames ?? []).length,
      },
      desktop: tokens.length
        ? {
            tokens: tokens.length,
            lastUsed: tokens[0].lastUsedAt?.toISOString().slice(0, 16) ?? null,
            version: tokens[0].clientVersion ?? "not reported yet (older app)",
            platform: tokens[0].clientPlatform ?? null,
          }
        : null,
      integrations: connections.map((c) => c.provider),
      google: google
        ? {
            gmailRead: /gmail\.readonly/.test(google.scope ?? ""),
            gmailDrafts: /gmail\.compose/.test(google.scope ?? ""),
            calendar: /calendar/.test(google.scope ?? ""),
            canRefresh: google.hasRefresh,
          }
        : null,
      morningBrief: brief[0]
        ? { enabled: brief[0].enabled, lastSentOn: brief[0].lastSentOn, draftReplies: (brief[0].prefs as { draftReplies?: boolean })?.draftReplies ?? true }
        : null,
      styleProfile: style[0] ? { built: Boolean(style[0].profile), sources: style[0].sourceCount, updated: style[0].updatedAt.toISOString().slice(0, 10) } : null,
      dealsLed: ledDeals[0]?.n ?? 0,
      openTeamTasks: openTasks[0]?.n ?? 0,
      playbook: Object.fromEntries(playbook.map((p) => [p.source, p.n])),
      aiLast7Days: usage,
      meetings: meetingRows,
      problemCount: meetingRows.reduce((n, m) => n + m.problems.filter((p) => p !== "not on a deal").length, 0),
    });
  }
  return NextResponse.json({ q, found: people.length, report });
}
