import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, teams, teamInvites } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId, createInviteAndNotify } from "@/lib/team";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  const members = await db.select().from(users).where(eq(users.teamId, teamId));
  const invites = await db.select().from(teamInvites).where(eq(teamInvites.teamId, teamId));

  return NextResponse.json({
    team,
    members: members.map((m) => ({ id: m.id, name: m.name, email: m.email })),
    invites: invites.map((i) => ({ id: i.id, email: i.email })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);

  const [existingMember] = await db
    .select()
    .from(users)
    .where(eq(users.email, email));
  if (existingMember?.teamId === teamId) {
    return NextResponse.json({ error: "Already on the team" }, { status: 400 });
  }

  const { invite, emailWarning } = await createInviteAndNotify({
    teamId,
    email,
    invitedByUserId: session.user.id,
    invitedByEmail: session.user.email!,
  });

  return NextResponse.json({ invite, emailWarning }, { status: 201 });
}
