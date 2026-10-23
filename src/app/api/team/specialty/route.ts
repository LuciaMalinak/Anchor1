import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams, users } from "@/db/schema";
import { isTeamLeader } from "@/lib/teamRoles";
import { getOrCreateTeamId } from "@/lib/team";
import { clearTeamSpecialty } from "@/lib/specialtyBuilder";
import { startSpecialtyBuild } from "@/lib/specialtyAuto";

// The team's own specialty (teamSpecialty.ts), for the team's leaders
// (the owner, and CEOs, managing partners and the like; teamRoles.ts):
// see it, build, rebuild or remove it. Its tools still show on deals for
// everyone. Builds run in the background (specialtyAuto.ts):
// POST starts one, GET reports "building" until it's ready.

async function ownerTeam() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const teamId = await getOrCreateTeamId(session.user.id);
  const [[team], [user]] = await Promise.all([
    db.select().from(teams).where(eq(teams.id, teamId)),
    db.select({ id: users.id, title: users.title, email: users.email }).from(users).where(eq(users.id, session.user.id)),
  ]);
  if (!team || !user) return { error: NextResponse.json({ error: "Team not found" }, { status: 404 }) };
  // Your Anchor is for the team's leaders: the owner, and CEOs, managing
  // partners and the like (teamRoles.ts).
  if (!isTeamLeader(user, team)) return { error: NextResponse.json({ error: "Only your team's leaders can see this" }, { status: 403 }) };
  return { userId: session.user.id, team, isOwner: true };
}

export async function GET() {
  const r = await ownerTeam();
  if ("error" in r) return r.error;
  return NextResponse.json({
    specialty: r.team.specialty ?? null,
    status: r.team.specialtyStatus ?? null,
    companyWebsite: r.team.companyWebsite ?? null,
    companyContext: r.team.companyContext ?? null,
    error: r.team.specialtyStatus === "failed" ? (r.team.specialtyError ?? null) : null,
    isOwner: r.isOwner,
  });
}

export async function POST(req: NextRequest) {
  const r = await ownerTeam();
  if ("error" in r) return r.error;
  if (!r.isOwner) return NextResponse.json({ error: "Only the team owner can change this" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const website =
    (typeof body.website === "string" && body.website.trim().slice(0, 200)) || r.team.companyWebsite || r.team.specialty?.website || "";
  // The context is saved for every later build, including automatic ones.
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 4000) : (r.team.companyContext ?? "");
  if (typeof body.description === "string") {
    await db.update(teams).set({ companyContext: description || null }).where(eq(teams.id, r.team.id));
  }
  if (!website && !description) {
    return NextResponse.json({ error: "Add the company's website or a line about what you do." }, { status: 400 });
  }
  const started = await startSpecialtyBuild(r.team.id, { website: website || null, description }, r.userId);
  return NextResponse.json({ status: "building", started });
}

export async function DELETE() {
  const r = await ownerTeam();
  if ("error" in r) return r.error;
  if (!r.isOwner) return NextResponse.json({ error: "Only the team owner can change this" }, { status: 403 });
  await clearTeamSpecialty(r.team.id);
  return NextResponse.json({ ok: true });
}
