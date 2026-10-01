import { db } from "@/db";
import { deals, meetings, tasks } from "@/db/schema";
import { and, asc, desc, eq, inArray, lte, max } from "drizzle-orm";
import { computeDealHealth, daysSinceActivity, type DealHealth } from "./dealHealth";
import { accessibleDealIds, dealVisibilityWhere } from "./dealAccess";

export type StaleDeal = {
  id: string;
  name: string;
  stage: string;
  health: DealHealth;
  daysSince: number;
};

export type StuckMeeting = {
  id: string;
  title: string;
  status: "joining" | "recording";
  minutesOld: number;
};

// A promise made in a call (a meeting-sourced task) still open days later.
export type OpenPromise = {
  taskId: string;
  text: string;
  ownerLabel: string | null;
  dealId: string;
  dealName: string;
  daysOpen: number;
};

export type AttentionSummary = {
  staleDeals: StaleDeal[];
  stuckMeetings: StuckMeeting[];
  openPromises: OpenPromise[];
};

const STUCK_MINUTES = 10;
const PROMISE_OPEN_DAYS = 5;

// Everything here is computed from existing data — nothing is stored —
// so it's always current and never needs its own cleanup job. Kept to a
// handful of items each: this is meant to be a quick "anything need a
// look?" glance on the way into the app, not an exhaustive report.
export async function getAttentionItems(params: {
  teamId: string;
  userId: string;
}): Promise<AttentionSummary> {
  // Only deals this person can see — a restricted deal's name shouldn't
  // show up on the home page of someone who isn't on it.
  const access = await accessibleDealIds(params.userId);
  if (!access || access.teamId !== params.teamId) {
    return { staleDeals: [], stuckMeetings: [], openPromises: [] };
  }
  const dealRows = await db
    .select({
      id: deals.id,
      name: deals.name,
      stage: deals.stage,
      createdAt: deals.createdAt,
      lastActivityAt: max(meetings.occurredAt),
    })
    .from(deals)
    .leftJoin(meetings, eq(meetings.dealId, deals.id))
    .where(dealVisibilityWhere(access))
    .groupBy(deals.id);

  const staleDeals: StaleDeal[] = dealRows
    .map((d) => {
      const lastActivityAt = d.lastActivityAt ? new Date(d.lastActivityAt) : null;
      const health = computeDealHealth({
        stage: d.stage,
        lastActivityAt,
        createdAt: d.createdAt,
      });
      return {
        id: d.id,
        name: d.name,
        stage: d.stage,
        health,
        daysSince: daysSinceActivity({ lastActivityAt, createdAt: d.createdAt }),
      };
    })
    .filter((d) => d.health === "needs-attention" || d.health === "stalled")
    .sort((a, b) => b.daysSince - a.daysSince)
    .slice(0, 5);

  const inFlight = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      status: meetings.status,
      createdAt: meetings.createdAt,
    })
    .from(meetings)
    .where(and(eq(meetings.userId, params.userId), inArray(meetings.status, ["joining", "recording"])))
    .orderBy(desc(meetings.createdAt));

  const stuckMeetings: StuckMeeting[] = inFlight
    .map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status as "joining" | "recording",
      minutesOld: Math.floor((Date.now() - m.createdAt.getTime()) / 60_000),
    }))
    .filter((m) => m.minutesOld > STUCK_MINUTES);

  // Promises from calls still open after a few days, on open deals only.
  const openDealIds = dealRows
    .filter((d) => d.stage !== "Closed won" && d.stage !== "Closed lost")
    .map((d) => d.id);
  const dealNameById = new Map(dealRows.map((d) => [d.id, d.name]));
  const promiseRows = openDealIds.length
    ? await db
        .select({ id: tasks.id, text: tasks.text, ownerLabel: tasks.ownerLabel, dealId: tasks.dealId, createdAt: tasks.createdAt })
        .from(tasks)
        .where(
          and(
            eq(tasks.teamId, params.teamId),
            eq(tasks.completed, false),
            eq(tasks.source, "meeting"),
            inArray(tasks.dealId, openDealIds),
            lte(tasks.createdAt, new Date(Date.now() - PROMISE_OPEN_DAYS * 86_400_000))
          )
        )
        .orderBy(asc(tasks.createdAt))
        .limit(5)
    : [];
  const openPromises: OpenPromise[] = promiseRows
    .filter((t): t is typeof t & { dealId: string } => Boolean(t.dealId))
    .map((t) => ({
      taskId: t.id,
      text: t.text,
      ownerLabel: t.ownerLabel,
      dealId: t.dealId,
      dealName: dealNameById.get(t.dealId) ?? "",
      daysOpen: Math.floor((Date.now() - t.createdAt.getTime()) / 86_400_000),
    }));

  return { staleDeals, stuckMeetings, openPromises };
}
