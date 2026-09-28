import { db } from "@/db";
import { meetings, deals, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export type HomeUpdate = {
  id: string;
  kind: "team" | "deal";
  text: string;
  href: string;
  at: string;
};

// A merged, read-only activity feed for the home page — computed from
// data that already exists (meetings, deals, team membership), not a new
// event log. Market news has its own dedicated spot already (the
// "TODAY'S BRIEFING" sidebar in the dashboard layout), so this covers
// what that doesn't: what's happened on the team and across deals.
export async function getHomeUpdates(params: { teamId: string; limit?: number }): Promise<HomeUpdate[]> {
  const limit = params.limit ?? 8;

  const [readyMeetings, recentDeals, recentTeammates] = await Promise.all([
    db
      .select({
        id: meetings.id,
        title: meetings.title,
        updatedAt: meetings.updatedAt,
        dealId: meetings.dealId,
        dealName: deals.name,
      })
      .from(meetings)
      .innerJoin(users, eq(meetings.userId, users.id))
      // Constrained on team here too, not just id — a meeting's dealId
      // pointing at another team's deal (possible from data created
      // before meetings/route.ts started validating it) would otherwise
      // still show that other team's real deal name in this feed.
      .leftJoin(deals, and(eq(meetings.dealId, deals.id), eq(deals.teamId, params.teamId)))
      .where(and(eq(users.teamId, params.teamId), eq(meetings.status, "ready")))
      .orderBy(desc(meetings.updatedAt))
      .limit(limit),
    db
      .select({ id: deals.id, name: deals.name, createdAt: deals.createdAt })
      .from(deals)
      .where(eq(deals.teamId, params.teamId))
      .orderBy(desc(deals.createdAt))
      .limit(limit),
    db
      .select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.teamId, params.teamId))
      .orderBy(desc(users.createdAt))
      .limit(limit),
  ]);

  const items: HomeUpdate[] = [
    ...readyMeetings.map((m) => ({
      id: `meeting-${m.id}`,
      kind: "deal" as const,
      text: m.dealName
        ? `Summary ready for "${m.title}" — ${m.dealName}`
        : `Summary ready for "${m.title}"`,
      href: `/dashboard/meetings/${m.id}`,
      at: m.updatedAt.toISOString(),
    })),
    ...recentDeals.map((d) => ({
      id: `deal-${d.id}`,
      kind: "deal" as const,
      text: `New deal added: ${d.name}`,
      href: `/dashboard/deals/${d.id}`,
      at: d.createdAt.toISOString(),
    })),
    ...recentTeammates.map((t) => ({
      id: `teammate-${t.id}`,
      kind: "team" as const,
      text: `${t.name || t.email} joined the team`,
      href: `/dashboard/team`,
      at: t.createdAt.toISOString(),
    })),
  ];

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return items.slice(0, limit);
}
