import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { getOrCreateTeamId } from "@/lib/team";
import { clearTeamSpecialty } from "@/lib/specialtyBuilder";
import { startSpecialtyBuild } from "@/lib/specialtyAuto";

// The team's own specialty (teamSpecialty.ts): anyone on the team can see
// it and whether one is being built; only the team owner can build,
// rebuild or remove it. Builds run in the background (specialtyAuto.ts):
// POST starts one, GET reports "building" until it's ready.

async function ownerTeam() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) return { error: NextResponse.json({ error: "Team not found" }, { status: 404 }) };
  return { userId: session.user.id, team, isOwner: team.ownerUserId === session.user.id };
}

export async function GET() {
  const r = await ownerTeam();
  if ("error" in r) return r.error;
  return NextResponse.json({
    specialty: r.team.specialty ?? null,
    status: r.team.specialtyStatus ?? null,
    companyWebsite: r.team.companyWebsite ?? null,
    isOwner: r.isOwner,
  });
}

export async function POST(req: NextRequest) {
  const r = await ownerTeam();
  if ("error" in r) return r.error;
  if (!r.isOwner) return NextResponse.json({ error: "Only the team owner can change this" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const website = typeof body.website === "string" ? body.website.trim().slice(0, 200) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : "";
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
