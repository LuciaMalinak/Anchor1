import { db } from "@/db";
import { meetings, sessions, teams, users } from "@/db/schema";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";

// Numbers for the admin Overview (src/app/dashboard/admin/AdminOverview.tsx):
// growth and activity across every account, and recordings that failed or
// got stuck, so problems show up here before anyone reports them.

const DAY_MS = 24 * 60 * 60 * 1000;
export const TREND_DAYS = 14;
// Auth.js database sessions last 30 days and are pushed forward (at most
// once a day) whenever the person uses the app — so a session expiring
// more than 30 - N days from now was used within the last N days. That's
// the only "last active" signal there is (accurate to about a day).
const SESSION_MAX_AGE_DAYS = 30;
// How long a meeting can sit in one state before it counts as stuck.
const STUCK_LIVE_MS = 4 * 60 * 60 * 1000; // joining/recording
const STUCK_PROCESSING_MS = 60 * 60 * 1000; // uploaded/transcribing/summarizing

export type MeetingSource =
  "Bot (Zoom/Teams)" | "Desktop" | "In person" | "Upload";

export function meetingSource(m: {
  recallBotId: string | null;
  recallRecordingId: string | null;
  audioFileName: string | null;
}): MeetingSource {
  if (m.recallBotId) return "Bot (Zoom/Teams)";
  if (m.recallRecordingId) return "Desktop";
  // The in-browser mic recorder names its uploads recording-<timestamp>.webm
  // (MicRecorder.tsx); one stopped without its audio has no file at all.
  if (!m.audioFileName || m.audioFileName.startsWith("recording-"))
    return "In person";
  return "Upload";
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The last TREND_DAYS calendar days (UTC), oldest first, each with a count.
function fillDays(rows: { day: string; count: number }[], now: Date) {
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  return Array.from({ length: TREND_DAYS }, (_, i) => {
    const day = dayKey(new Date(now.getTime() - (TREND_DAYS - 1 - i) * DAY_MS));
    return { day, count: byDay.get(day) ?? 0 };
  });
}

export async function loadAdminOverview() {
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const trendStart = new Date(`${dayKey(ago(TREND_DAYS - 1))}T00:00:00Z`);
  const activeSince = (days: number) =>
    new Date(now.getTime() + (SESSION_MAX_AGE_DAYS - days) * DAY_MS);
  const dayExpr = (col: typeof users.createdAt | typeof meetings.createdAt) =>
    sql<string>`to_char(date_trunc('day', ${col} at time zone 'UTC'), 'YYYY-MM-DD')`;

  const [
    [userTotals],
    [teamTotals],
    [active7],
    [active30],
    [meetingTotals],
    signupRows,
    meetingRows,
    topTeams,
    recentSignups,
    failed,
    stuck,
    commonErrors,
  ] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        new7: sql<number>`count(*) filter (where ${users.createdAt} >= ${ago(7)})`,
        new30: sql<number>`count(*) filter (where ${users.createdAt} >= ${ago(30)})`,
      })
      .from(users),
    db.select({ total: sql<number>`count(*)` }).from(teams),
    db
      .select({ count: sql<number>`count(distinct ${sessions.userId})` })
      .from(sessions)
      .where(gte(sessions.expires, activeSince(7))),
    db
      .select({ count: sql<number>`count(distinct ${sessions.userId})` })
      .from(sessions)
      .where(gte(sessions.expires, activeSince(30))),
    db
      .select({
        week: sql<number>`count(*) filter (where ${meetings.createdAt} >= ${ago(7)})`,
        readyWeek: sql<number>`count(*) filter (where ${meetings.createdAt} >= ${ago(7)} and ${meetings.status} = 'ready')`,
        failedWeek: sql<number>`count(*) filter (where ${meetings.createdAt} >= ${ago(7)} and ${meetings.status} = 'failed')`,
        total: sql<number>`count(*)`,
      })
      .from(meetings),
    db
      .select({ day: dayExpr(users.createdAt), count: sql<number>`count(*)` })
      .from(users)
      .where(gte(users.createdAt, trendStart))
      .groupBy(sql`1`),
    db
      .select({
        day: dayExpr(meetings.createdAt),
        count: sql<number>`count(*)`,
      })
      .from(meetings)
      .where(gte(meetings.createdAt, trendStart))
      .groupBy(sql`1`),
    // Teams by meetings in the last 30 days.
    db
      .select({
        teamId: teams.id,
        name: teams.name,
        meetings: sql<number>`count(${meetings.id})`,
        people: sql<number>`count(distinct ${meetings.userId})`,
        lastMeetingAt: sql<Date>`max(${meetings.createdAt})`,
      })
      .from(meetings)
      .innerJoin(users, eq(users.id, meetings.userId))
      .innerJoin(teams, eq(teams.id, users.teamId))
      .where(gte(meetings.createdAt, ago(30)))
      .groupBy(teams.id, teams.name)
      .orderBy(desc(sql`count(${meetings.id})`))
      .limit(8),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        createdAt: users.createdAt,
        teamId: users.teamId,
        teamName: teams.name,
      })
      .from(users)
      .leftJoin(teams, eq(teams.id, users.teamId))
      .orderBy(desc(users.createdAt))
      .limit(8),
    db
      .select({
        id: meetings.id,
        title: meetings.title,
        errorMessage: meetings.errorMessage,
        updatedAt: meetings.updatedAt,
        recallBotId: meetings.recallBotId,
        recallRecordingId: meetings.recallRecordingId,
        audioFileName: meetings.audioFileName,
        userEmail: users.email,
        teamId: users.teamId,
        teamName: teams.name,
      })
      .from(meetings)
      .innerJoin(users, eq(users.id, meetings.userId))
      .leftJoin(teams, eq(teams.id, users.teamId))
      .where(
        and(eq(meetings.status, "failed"), gte(meetings.updatedAt, ago(14))),
      )
      .orderBy(desc(meetings.updatedAt))
      .limit(25),
    db
      .select({
        id: meetings.id,
        title: meetings.title,
        status: meetings.status,
        createdAt: meetings.createdAt,
        updatedAt: meetings.updatedAt,
        recallBotId: meetings.recallBotId,
        recallRecordingId: meetings.recallRecordingId,
        audioFileName: meetings.audioFileName,
        userEmail: users.email,
        teamId: users.teamId,
        teamName: teams.name,
      })
      .from(meetings)
      .innerJoin(users, eq(users.id, meetings.userId))
      .leftJoin(teams, eq(teams.id, users.teamId))
      .where(
        or(
          and(
            inArray(meetings.status, ["joining", "recording"]),
            lt(meetings.createdAt, new Date(now.getTime() - STUCK_LIVE_MS)),
          ),
          and(
            inArray(meetings.status, [
              "uploaded",
              "transcribing",
              "summarizing",
            ]),
            lt(
              meetings.updatedAt,
              new Date(now.getTime() - STUCK_PROCESSING_MS),
            ),
          ),
        ),
      )
      .orderBy(desc(meetings.updatedAt))
      .limit(25),
    // The failure reasons that keep coming up (last 30 days).
    db
      .select({ message: meetings.errorMessage, count: sql<number>`count(*)` })
      .from(meetings)
      .where(
        and(eq(meetings.status, "failed"), gte(meetings.updatedAt, ago(30))),
      )
      .groupBy(meetings.errorMessage)
      .orderBy(desc(sql`count(*)`))
      .limit(5),
  ]);

  return {
    users: {
      total: Number(userTotals.total),
      new7: Number(userTotals.new7),
      new30: Number(userTotals.new30),
      active7: Number(active7.count),
      active30: Number(active30.count),
    },
    teams: Number(teamTotals.total),
    meetings: {
      total: Number(meetingTotals.total),
      week: Number(meetingTotals.week),
      readyWeek: Number(meetingTotals.readyWeek),
      failedWeek: Number(meetingTotals.failedWeek),
    },
    signupsByDay: fillDays(
      signupRows.map((r) => ({ day: r.day, count: Number(r.count) })),
      now,
    ),
    meetingsByDay: fillDays(
      meetingRows.map((r) => ({ day: r.day, count: Number(r.count) })),
      now,
    ),
    topTeams: topTeams.map((t) => ({
      ...t,
      meetings: Number(t.meetings),
      people: Number(t.people),
      lastMeetingAt: new Date(t.lastMeetingAt),
    })),
    recentSignups,
    failed: failed.map((m) => ({ ...m, source: meetingSource(m) })),
    stuck: stuck.map((m) => ({ ...m, source: meetingSource(m) })),
    commonErrors: commonErrors.map((e) => ({
      message: e.message || "(no error message)",
      count: Number(e.count),
    })),
  };
}

export type AdminOverview = Awaited<ReturnType<typeof loadAdminOverview>>;
