import { auth } from "@/auth";
import { db } from "@/db";
import { users, teams, teamInvites } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { TeamClient } from "./TeamClient";

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  const members = await db.select().from(users).where(eq(users.teamId, teamId));
  const invites = await db.select().from(teamInvites).where(eq(teamInvites.teamId, teamId));

  return (
    <TeamClient
      teamName={team?.name || "My Team"}
      members={members.map((m) => ({ id: m.id, name: m.name, email: m.email, title: m.title, image: m.image }))}
      invites={invites.map((i) => ({ id: i.id, email: i.email }))}
      currentUserId={session.user.id}
    />
  );
}
