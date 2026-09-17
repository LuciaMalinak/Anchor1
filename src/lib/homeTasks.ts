import { db } from "@/db";
import { tasks, deals, meetings } from "@/db/schema";
import { and, eq, max } from "drizzle-orm";
import { computeDealHealth, daysSinceActivity, type DealHealth } from "./dealHealth";

export type HomeTask = {
  id: string;
  text: string;
  ownerLabel: string | null;
  completed: boolean;
  dealId: string | null;
  dealName: string | null;
  dealHealth: DealHealth | "none";
  daysSinceActivity: number | null;
  source: "meeting" | "manual";
  createdAt: string;
};

// Lower number = shows first. Deals that have gone quiet float to the
// top (that's exactly when a nudged-along task matters most); a
// still-open task with no deal attached sits in the middle; a task left
// over from an already-closed deal sinks to the bottom — it's done,
// there's nothing left to chase.
const HEALTH_RANK: Record<DealHealth | "none", number> = {
  stalled: 0,
  "needs-attention": 1,
  "on-track": 2,
  none: 3,
  closed: 4,
};

// Everything a teammate needs to see on the home page's to-do list —
// open tasks across every deal on the team, ranked by how urgently that
// deal needs attention (see dealHealth.ts), oldest first within the same
// rank so nothing quietly sits forever just because newer tasks keep
// arriving on top of it.
export async function getHomeTasks(params: { teamId: string; limit?: number }): Promise<HomeTask[]> {
  const rows = await db
    .select({
      id: tasks.id,
      text: tasks.text,
      ownerLabel: tasks.ownerLabel,
      completed: tasks.completed,
      source: tasks.source,
      createdAt: tasks.createdAt,
      dealId: tasks.dealId,
      dealName: deals.name,
      dealStage: deals.stage,
      dealCreatedAt: deals.createdAt,
      lastActivityAt: max(meetings.occurredAt),
    })
    .from(tasks)
    .leftJoin(deals, eq(tasks.dealId, deals.id))
    .leftJoin(meetings, eq(meetings.dealId, tasks.dealId))
    .where(and(eq(tasks.teamId, params.teamId), eq(tasks.completed, false)))
    .groupBy(
      tasks.id,
      tasks.text,
      tasks.ownerLabel,
      tasks.completed,
      tasks.source,
      tasks.createdAt,
      tasks.dealId,
      deals.name,
      deals.stage,
      deals.createdAt
    );

  const withHealth = rows.map((r) => {
    const lastActivityAt = r.lastActivityAt ? new Date(r.lastActivityAt) : null;
    const health: DealHealth | "none" = r.dealId
      ? computeDealHealth({
          stage: r.dealStage!,
          lastActivityAt,
          createdAt: r.dealCreatedAt!,
        })
      : "none";
    return {
      id: r.id,
      text: r.text,
      ownerLabel: r.ownerLabel,
      completed: r.completed,
      dealId: r.dealId,
      dealName: r.dealName,
      dealHealth: health,
      daysSinceActivity: r.dealId
        ? daysSinceActivity({ lastActivityAt, createdAt: r.dealCreatedAt! })
        : null,
      source: r.source as "meeting" | "manual",
      createdAt: r.createdAt.toISOString(),
      _sortCreatedAt: r.createdAt.getTime(),
    };
  });

  withHealth.sort((a, b) => {
    const rankDiff = HEALTH_RANK[a.dealHealth] - HEALTH_RANK[b.dealHealth];
    if (rankDiff !== 0) return rankDiff;
    return a._sortCreatedAt - b._sortCreatedAt;
  });

  const limit = params.limit ?? 25;
  return withHealth.slice(0, limit).map((t) => ({
    id: t.id,
    text: t.text,
    ownerLabel: t.ownerLabel,
    completed: t.completed,
    dealId: t.dealId,
    dealName: t.dealName,
    dealHealth: t.dealHealth,
    daysSinceActivity: t.daysSinceActivity,
    source: t.source,
    createdAt: t.createdAt,
  }));
}
