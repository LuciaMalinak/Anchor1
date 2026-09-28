import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { announcements, teams } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";

// Owner-only, same bar as posting one.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team || team.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "Only the team owner can remove announcements" }, { status: 403 });
  }

  const [existing] = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(and(eq(announcements.id, id), eq(announcements.teamId, teamId)));
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(announcements).where(eq(announcements.id, id));

  return NextResponse.json({ ok: true });
}
