import { auth } from "@/auth";
import { db } from "@/db";
import { deals, meetings } from "@/db/schema";
import { desc, eq, count } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
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
      meetingCount: count(meetings.id),
    })
    .from(deals)
    .leftJoin(meetings, eq(meetings.dealId, deals.id))
    .where(eq(deals.teamId, teamId))
    .groupBy(deals.id)
    .orderBy(desc(deals.updatedAt));

  return (
    <DealsClient
      initialDeals={rows.map((d) => ({ ...d, meetingCount: Number(d.meetingCount) }))}
    />
  );
}
