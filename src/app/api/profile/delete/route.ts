import { NextResponse } from "next/server";
import { logDataChange } from "@/lib/dataChangeLog";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, teams, deals } from "@/db/schema";
import { anonymizeAccount } from "@/lib/deleteAccount";
import { eq, and, ne } from "drizzle-orm";
import { sessionCookieName, secureCookiesEnabled } from "@/lib/auth/password";

// Deliberately never issues a hard DELETE on the user row itself. A few
// columns reference users.id with no onDelete rule at all
// (deals.createdByUserId, dealFiles.uploadedByUserId,
// teamInvites.invitedByUserId) — a real delete would fail with a foreign
// key error for almost any account that's actually created a deal or
// uploaded a file, which is most of them. Anonymizing gets the same
// result from the person's point of view (signed out everywhere, no way
// back in, no personal info left behind) without risking a half-finished
// delete that leaves other people's shared deals pointing at nothing.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const userId = session.user.id;

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  if (user.teamId) {
    const [team] = await db.select().from(teams).where(eq(teams.id, user.teamId));
    if (team && team.ownerUserId === userId) {
      const otherMembers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.teamId, team.id), ne(users.id, userId)));
      if (otherMembers.length > 0) {
        return NextResponse.json(
          {
            error:
              "You're the owner of a team with other people still on it — remove them first, or reach out and we'll help move ownership before you delete your account.",
          },
          { status: 400 }
        );
      }
      // Sole owner of their own team. The team and everything on it
      // (deals, calls, files, tasks) is kept, with nobody on it, so it
      // can be given back if the account was deleted by mistake; the
      // person themselves can no longer sign in or see it.
      const teamDeals = await db.select({ id: deals.id, name: deals.name }).from(deals).where(eq(deals.teamId, team.id));
      await logDataChange({
        action: "team_deleted",
        actorUserId: userId,
        actorEmail: user.email,
        teamId: team.id,
        targetId: userId,
        details: { teamName: team.name, reason: "owner deleted their account; team and data kept", deals: teamDeals.map((d) => d.name) },
      });
    }
  }

  await anonymizeAccount(userId, { userId, email: user.email, reason: "deleted their own account" });

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: sessionCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookiesEnabled(),
    maxAge: 0,
  });
  return res;
}
