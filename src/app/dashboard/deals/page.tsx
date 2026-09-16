import { auth } from "@/auth";
import { db } from "@/db";
import { deals, meetings } from "@/db/schema";
import { desc, eq, count, max } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { computeDealHealth } from "@/lib/dealHealth";
import { DealsClient } from "./DealsClient";

export default async function DealsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const teamId = await getOrCreateTeamId(session.user.id);
  const rows = await db
    .select({
      id: deals.id,
      name: deals.name,
      stage: deals.stage,
      createdAt: deals.createdAt,
      meetingCount: count(meetings.id),
      lastActivityAt: max(meetings.occurredAt),
    })
    .from(deals)
    .leftJoin(meetings, eq(meetings.dealId, deals.id))
    .where(eq(deals.teamId, teamId))
    .groupBy(deals.id)
    .orderBy(desc(deals.updatedAt));

  return (
    <DealsClient
      initialDeals={rows.map((d) => {
        const lastActivityAt = d.lastActivityAt ? new Date(d.lastActivityAt) : null;
        return {
          id: d.id,
          name: d.name,
          stage: d.stage,
          meetingCount: Number(d.meetingCount),
          health: computeDealHealth({ stage: d.stage, lastActivityAt, createdAt: d.createdAt }),
        };
      })}
    />
  );
}
