import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { getOrCreateTeamId } from "@/lib/team";
import { buildTeamSpecialty, clearTeamSpecialty } from "@/lib/specialtyBuilder";
import { withAiUser } from "@/lib/aiUsage";

// The team's own specialty (teamSpecialty.ts): anyone on the team can see
// it; only the team owner can build, rebuild or remove it.
export const maxDuration = 300;

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
  return NextResponse.json({ specialty: r.team.specialty ?? null, isOwner: r.isOwner });
}

export async function POST(req: NextRequest) {
  const r = await ownerTeam();
  if ("error" in r) return r.error;
  if (!r.isOwner) return NextResponse.json({ error: "Only the team owner can change this" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    const specialty = await withAiUser({ userId: r.userId }, () =>
      buildTeamSpecialty(r.team.id, { website: body.website, description: body.description })
    );
    return NextResponse.json({ specialty });
  } catch (err) {
    console.error("[team specialty]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't build it. Try again." }, { status: 502 });
  }
}

export async function DELETE() {
  const r = await ownerTeam();
  if ("error" in r) return r.error;
  if (!r.isOwner) return NextResponse.json({ error: "Only the team owner can change this" }, { status: 403 });
  await clearTeamSpecialty(r.team.id);
  return NextResponse.json({ ok: true });
}
