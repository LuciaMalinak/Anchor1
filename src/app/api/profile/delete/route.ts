import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, sessions, accounts, teams } from "@/db/schema";
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
      // Sole owner of their own team — deleting the team cascades to
      // everything scoped to it (deals, meetings, tasks, integrations…),
      // which is exactly what "delete my account" should mean when
      // nobody else is relying on that data.
      await db.delete(teams).where(eq(teams.id, team.id));
    }
  }

  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db
    .update(users)
    .set({
      name: null,
      // Freed up for reuse and made impossible to sign back in with —
      // unique + not-null, so it can't just be left as-is.
      email: `deleted-${randomUUID()}@anchor.invalid`,
      emailVerified: null,
      image: null,
      passwordHash: null,
      title: null,
      phone: null,
      linkedin: null,
      department: null,
      otherInfo: null,
    })
    .where(eq(users.id, userId));

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
