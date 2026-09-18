import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, teams, teamInvites } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId, createInviteAndNotify } from "@/lib/team";
import { isIndustryKey } from "@/lib/industries";

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

// Sets (or clears) the team's industry — only the team owner can change
// it, same permission the rest of the app treats as "can change
// team-wide settings" (see src/lib/joinRequestAccess.ts for the same
// ownerUserId check used elsewhere).
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team || team.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "Only the team owner can change this" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const industry = body.industry;
  if (industry !== null && !(typeof industry === "string" && isIndustryKey(industry))) {
    return NextResponse.json({ error: "Not a recognized industry" }, { status: 400 });
  }

  // Clear the cached daily briefing and news ticker along with the
  // industry change — both are keyed off industry when they're built
  // (see src/lib/dailyBriefing.ts and src/lib/industryTicker.ts), but
  // neither one re-checks industry on every read, only when its own
  // staleness window (up to 20 minutes for the ticker, 6 hours for the
  // briefing) expires. Without this, switching industries would keep
  // showing the old industry's news until that window happened to pass.
  await db
    .update(teams)
    .set({
      industry,
      dailyBriefing: null,
      dailyBriefingUpdatedAt: null,
      industryTicker: null,
      industryTickerUpdatedAt: null,
    })
    .where(eq(teams.id, teamId));
  return NextResponse.json({ ok: true, industry });
}
