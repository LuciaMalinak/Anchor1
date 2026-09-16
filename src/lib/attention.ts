import { db } from "@/db";
import { deals, meetings } from "@/db/schema";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import { computeDealHealth, daysSinceActivity, type DealHealth } from "./dealHealth";

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

export type AttentionSummary = {
  staleDeals: StaleDeal[];
  stuckMeetings: StuckMeeting[];
};

const STUCK_MINUTES = 10;

// Everything here is computed from existing data — nothing is stored —
// so it's always current and never needs its own cleanup job. Kept to a
// handful of items each: this is meant to be a quick "anything need a
// look?" glance on the way into the app, not an exhaustive report.
export async function getAttentionItems(params: {
  teamId: string;
  userId: string;
}): Promise<AttentionSummary> {
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
    .where(eq(deals.teamId, params.teamId))
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

  return { staleDeals, stuckMeetings };
}
