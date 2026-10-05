import { db } from "@/db";
import {
  apiTokens,
  dealFiles,
  dealMessages,
  deals,
  meetings,
  sessions,
  supportRequests,
  taskComments,
  tasks,
} from "@/db/schema";
import { and, desc, inArray, isNotNull, max, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

// When each member last used Anchor, and the last thing they actually did,
// for the admin pages. Nothing records page views, so this is pieced
// together from what members leave behind: meetings, deals, deal messages,
// tasks, comments, file uploads, help requests, Anchor Desktop use — plus
// their sign-in session, which shows they opened the app even when they
// didn't create anything.

// Auth.js database sessions last 30 days and are pushed forward (at most
// once a day) whenever the person uses the app, so expires - 30 days is
// when they last loaded a page (the most recent one that refreshed it).
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type Activity = {
  at: Date;
  // What they did, e.g. "Recorded a meeting".
  kind: string;
  // What it was about (a meeting title, deal name, file name). Only shown
  // on the team page, which logs the admin's access — not on the overview.
  detail: string | null;
};

export type MemberActivity = {
  // Latest sign of them using Anchor at all, including just opening it.
  lastActiveAt: Date | null;
  // Latest thing they did (opening the app doesn't count).
  lastActivity: Activity | null;
};

// Pass userIds to limit it to those members (a team page); omit for all.
export async function loadMemberActivity(userIds?: string[]): Promise<Map<string, MemberActivity>> {
  if (userIds && userIds.length === 0) return new Map();
  const only = (col: PgColumn): SQL | undefined =>
    userIds ? inArray(col, userIds) : isNotNull(col);

  // The newest row per member from one table.
  const latest = async (
    userCol: PgColumn,
    atCol: PgColumn,
    detailCol: PgColumn | null,
    from: PgTable,
    kind: string,
  ) => {
    const rows = await db
      .selectDistinctOn([userCol], {
        userId: userCol,
        at: atCol,
        ...(detailCol ? { detail: detailCol } : {}),
      })
      .from(from)
      // Postgres sorts nulls first in DESC — an unused desktop token would
      // otherwise beat a used one.
      .where(and(only(userCol), isNotNull(atCol)))
      .orderBy(userCol, desc(atCol));
    return rows.map((r) => ({
      userId: r.userId as string,
      activity: {
        at: r.at as Date,
        kind,
        detail: ((r as { detail?: string | null }).detail ?? null) || null,
      },
    }));
  };

  const [actions, visits] = await Promise.all([
    Promise.all([
      latest(meetings.userId, meetings.createdAt, meetings.title, meetings, "Recorded a meeting"),
      latest(deals.createdByUserId, deals.createdAt, deals.name, deals, "Added a deal"),
      latest(dealMessages.userId, dealMessages.createdAt, null, dealMessages, "Sent a deal message"),
      latest(tasks.createdByUserId, tasks.createdAt, tasks.text, tasks, "Added a task"),
      latest(taskComments.userId, taskComments.createdAt, null, taskComments, "Commented on a task"),
      latest(dealFiles.uploadedByUserId, dealFiles.createdAt, dealFiles.fileName, dealFiles, "Uploaded a file"),
      latest(supportRequests.userId, supportRequests.createdAt, null, supportRequests, "Asked for help"),
      latest(apiTokens.userId, apiTokens.lastUsedAt, null, apiTokens, "Used Anchor Desktop"),
    ]),
    db
      .select({ userId: sessions.userId, expires: max(sessions.expires) })
      .from(sessions)
      .where(only(sessions.userId))
      .groupBy(sessions.userId),
  ]);

  const result = new Map<string, MemberActivity>();
  const entry = (userId: string) => {
    let e = result.get(userId);
    if (!e) {
      e = { lastActiveAt: null, lastActivity: null };
      result.set(userId, e);
    }
    return e;
  };
  const later = (a: Date | null, b: Date) => (!a || b > a ? b : a);

  for (const { userId, activity } of actions.flat()) {
    const e = entry(userId);
    e.lastActiveAt = later(e.lastActiveAt, activity.at);
    if (!e.lastActivity || activity.at > e.lastActivity.at) e.lastActivity = activity;
  }
  const now = Date.now();
  for (const v of visits) {
    if (!v.expires) continue;
    const seen = new Date(Math.min(now, new Date(v.expires).getTime() - SESSION_MAX_AGE_MS));
    const e = entry(v.userId);
    e.lastActiveAt = later(e.lastActiveAt, seen);
  }
  return result;
}

export function timeAgo(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Members quiet for longer than this are flagged on the admin pages.
export const INACTIVE_AFTER_DAYS = 14;

export function isInactive(a: MemberActivity | undefined): boolean {
  if (!a?.lastActiveAt) return true;
  return Date.now() - a.lastActiveAt.getTime() > INACTIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
