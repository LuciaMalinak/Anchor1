import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams, users } from "@/db/schema";

// The signed-in person and their team, when they're the team's owner —
// for the owner-only data and security controls on the Team page.
export async function teamOwnerContext() {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not signed in", status: 401 } as const;
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
  if (!user?.teamId) return { error: "No team", status: 404 } as const;
  const [team] = await db.select().from(teams).where(eq(teams.id, user.teamId));
  if (!team || team.ownerUserId !== user.id) return { error: "Only the team owner can do this.", status: 403 } as const;
  return { user, team } as const;
}
