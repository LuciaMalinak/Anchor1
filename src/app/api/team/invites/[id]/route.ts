import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams, teamInvites } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";

// Owner-only — cancels a pending invite (the "Waiting to sign in" rows on
// the Team page) before anyone's signed up with it. This just deletes the
// teamInvites row; if that email later signs in anyway they'll join their
// own fresh team like any new account, not this one, since the invite
// record — the only thing that would have linked them here — is gone.
// See src/lib/onboardUser.ts for the normal, non-cancelled path: signing
// in with an invited email deletes this same row and joins the team.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: inviteId } = await params;

  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team || team.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "Only the team owner can cancel invites" }, { status: 403 });
  }

  const [invite] = await db
    .select()
    .from(teamInvites)
    .where(and(eq(teamInvites.id, inviteId), eq(teamInvites.teamId, teamId)));
  if (!invite) {
    return NextResponse.json({ error: "That invite doesn't exist anymore" }, { status: 404 });
  }

  await db.delete(teamInvites).where(eq(teamInvites.id, inviteId));

  return NextResponse.json({ ok: true });
}
