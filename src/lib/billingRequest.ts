import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams, users } from "@/db/schema";
import { getOrCreateTeamId } from "@/lib/team";
import { isAppOwner } from "@/lib/appOwner";

// The signed-in person and their team, for the billing routes and page.
// Only the team's owner (or the app owner) may subscribe or change it.
export async function billingContext() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const teamId = await getOrCreateTeamId(userId);
  const [[team], [user]] = await Promise.all([
    db.select().from(teams).where(eq(teams.id, teamId)),
    db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, userId)),
  ]);
  if (!team || !user) return null;
  const canManage = team.ownerUserId === userId || isAppOwner(user.email);
  return { user, team, canManage };
}

// Same fallback as the integrations routes: the explicit URL behind
// Render's proxy, otherwise the request's own origin.
export function baseUrl(req: NextRequest): string {
  return (process.env.AUTH_URL || req.nextUrl.origin).replace(/\/$/, "");
}
