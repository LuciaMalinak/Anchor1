import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, teams, teamInvites } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { sendEmail } from "@/lib/email";

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

  const [invite] = await db
    .insert(teamInvites)
    .values({ teamId, email, invitedByUserId: session.user.id })
    .returning();

  let emailWarning: string | null = null;
  try {
    await sendEmail({
      to: email,
      subject: "You've been added to an Anchor team",
      html: `<p>${session.user.email} invited you to their team on Anchor.</p><p>Sign in at the same email address to join: <a href="${process.env.AUTH_URL}/sign-in">${process.env.AUTH_URL}/sign-in</a></p>`,
    });
  } catch (err) {
    // Don't fail the invite over email delivery — Resend's shared testing
    // sender can only deliver to the account owner until a domain is
    // verified. The invite record itself still works: whoever signs in
    // with this email joins the team regardless of whether they got a
    // notification about it.
    emailWarning = err instanceof Error ? err.message : "Couldn't send the invite email";
  }

  return NextResponse.json({ invite, emailWarning }, { status: 201 });
}
