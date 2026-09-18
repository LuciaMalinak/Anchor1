import { auth } from "@/auth";
import { db } from "@/db";
import { users, teams, teamInvites, deals, joinRequests } from "@/db/schema";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { canManageJoinRequests } from "@/lib/joinRequestAccess";
import { isAppOwner } from "@/lib/appOwner";
import { TeamClient } from "./TeamClient";

type DealOption = { id: string; name: string };
type JoinRequestItem = {
  id: string;
  name: string;
  email: string;
  dealName: string;
  createdAt: string;
  deals: DealOption[];
  teamName?: string;
};

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

  // Only shown to whoever can actually act on them — the team owner, a
  // deal lead on this team, or the app owner (see
  // src/lib/joinRequestAccess.ts). Everyone else still sees the share
  // link above (anyone can hand it out), just not the requests it
  // produces.
  const canManage = await canManageJoinRequests(session.user.id, session.user.email, teamId);
  const pendingRequestRows = canManage
    ? await db
        .select()
        .from(joinRequests)
        .where(and(eq(joinRequests.teamId, teamId), eq(joinRequests.status, "pending")))
        .orderBy(desc(joinRequests.createdAt))
    : [];
  const pendingRequests: JoinRequestItem[] = pendingRequestRows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    dealName: r.dealName,
    createdAt: r.createdAt.toISOString(),
    deals: teamDeals,
  }));

  // The app owner additionally sees pending requests for every OTHER
  // team in the system (her own team's requests are already covered by
  // the section above) — each with that team's own name and deal list,
  // since the deal picker has to offer the right team's deals.
  let otherTeamRequests: JoinRequestItem[] = [];
  if (isAppOwner(session.user.email)) {
    const rows = await db
      .select({
        id: joinRequests.id,
        name: joinRequests.name,
        email: joinRequests.email,
        dealName: joinRequests.dealName,
        createdAt: joinRequests.createdAt,
        teamId: joinRequests.teamId,
        teamName: teams.name,
      })
      .from(joinRequests)
      .innerJoin(teams, eq(teams.id, joinRequests.teamId))
      .where(and(eq(joinRequests.status, "pending"), ne(joinRequests.teamId, teamId)))
      .orderBy(desc(joinRequests.createdAt));

    const otherTeamIds = Array.from(new Set(rows.map((r) => r.teamId)));
    const otherDeals = otherTeamIds.length
      ? await db
          .select({ id: deals.id, name: deals.name, teamId: deals.teamId })
          .from(deals)
          .where(inArray(deals.teamId, otherTeamIds))
      : [];
    const dealsByTeam = new Map<string, { id: string; name: string }[]>();
    for (const d of otherDeals) {
      const list = dealsByTeam.get(d.teamId) ?? [];
      list.push({ id: d.id, name: d.name });
      dealsByTeam.set(d.teamId, list);
    }

    otherTeamRequests = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      dealName: r.dealName,
      createdAt: r.createdAt.toISOString(),
      teamName: r.teamName,
      deals: dealsByTeam.get(r.teamId) ?? [],
    }));
  }

  return (
    <TeamClient
      teamId={teamId}
      teamName={team?.name || "My Team"}
      members={members.map((m) => ({ id: m.id, name: m.name, email: m.email, title: m.title, image: m.image }))}
      invites={invites.map((i) => ({ id: i.id, email: i.email }))}
      pendingRequests={pendingRequests}
      otherTeamRequests={otherTeamRequests}
      currentUserId={session.user.id}
      industry={team?.industry ?? null}
      isOwner={team?.ownerUserId === session.user.id}
    />
  );
}
