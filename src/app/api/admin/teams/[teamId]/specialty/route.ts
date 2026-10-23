import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { logAdminAccess, requireAppOwnerApi } from "@/lib/adminAccess";
import { buildTeamSpecialty, clearTeamSpecialty } from "@/lib/specialtyBuilder";
import { withAiUser } from "@/lib/aiUsage";

// Anchor's admin building a client team's specialty for them (from the
// admin team page), e.g. while setting a new client up. Unlike the rest
// of the admin area this changes the team, so every use is logged in the
// admin access log like any admin view.
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const admin = await requireAppOwnerApi();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { teamId } = await params;
  const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  await logAdminAccess(admin.id, teamId, "built team specialty");
  const body = await req.json().catch(() => ({}));
  try {
    const specialty = await withAiUser({ userId: admin.id }, () =>
      buildTeamSpecialty(teamId, { website: body.website, description: body.description })
    );
    return NextResponse.json({ specialty });
  } catch (err) {
    console.error("[admin team specialty]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't build it. Try again." }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const admin = await requireAppOwnerApi();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { teamId } = await params;
  await logAdminAccess(admin.id, teamId, "removed team specialty");
  await clearTeamSpecialty(teamId);
  return NextResponse.json({ ok: true });
}
