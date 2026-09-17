import { auth } from "@/auth";
import { db } from "@/db";
import { users, teams, teamInvites, deals, joinRequests } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { TeamClient } from "./TeamClient";

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  const members = await db.select().from(users).where(eq(users.teamId, teamId));
  const invites = await db.select().from(teamInvites).where(eq(teamInvites.teamId, teamId));
  const teamDeals = await db
    .select({ id: deals.id, name: deals.name })
    .from(deals)
    .where(eq(deals.teamId, teamId))
    .orderBy(desc(deals.updatedAt));
  const pendingRequests = await db
    .select()
    .from(joinRequests)
    .where(and(eq(joinRequests.teamId, teamId), eq(joinRequests.status, "pending")))
    .orderBy(desc(joinRequests.createdAt));

  return (
    <TeamClient
      teamId={teamId}
      teamName={team?.name || "My Team"}
      members={members.map((m) => ({ id: m.id, name: m.name, email: m.email, title: m.title, image: m.image }))}
      invites={invites.map((i) => ({ id: i.id, email: i.email }))}
      deals={teamDeals}
      pendingRequests={pendingRequests.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        dealName: r.dealName,
        createdAt: r.createdAt.toISOString(),
      }))}
      currentUserId={session.user.id}
    />
  );
}
