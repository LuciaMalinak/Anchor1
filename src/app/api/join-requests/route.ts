import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teams, users, joinRequests } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { sendEmail } from "@/lib/email";

// Public, unauthenticated — this is the endpoint behind the form at
// /join/[teamId]. Anyone with the link can submit a request; it just sits
// as "pending" until someone already on the team approves or declines it
// from the Team page. No account is created here.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const dealName = typeof body.dealName === "string" ? body.dealName.trim() : "";

  if (!name || !email || !email.includes("@") || !dealName) {
    return NextResponse.json(
      { error: "Fill in your name, email, and which deal or client you're here for." },
      { status: 400 }
    );
  }

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) {
    return NextResponse.json({ error: "That join link doesn't look right." }, { status: 404 });
  }

  const [existingMember] = await db.select().from(users).where(eq(users.email, email));
  if (existingMember?.teamId === teamId) {
    return NextResponse.json(
      { error: "This email is already on the team — try signing in instead." },
      { status: 400 }
    );
  }

  // Refresh rather than duplicate if they already have a pending request
  // in on this team (e.g. they double-submitted, or are asking about a
  // different deal this time).
  const [existingRequest] = await db
    .select()
    .from(joinRequests)
    .where(
      and(
        eq(joinRequests.teamId, teamId),
        sql`lower(${joinRequests.email}) = lower(${email})`,
        eq(joinRequests.status, "pending")
      )
    );

  if (existingRequest) {
    await db
      .update(joinRequests)
      .set({ name, dealName })
      .where(eq(joinRequests.id, existingRequest.id));
  } else {
    await db.insert(joinRequests).values({ teamId, name, email, dealName });
  }

  // Best-effort notification to everyone currently on the team — there's
  // no separate "owner" role, so whoever's around can review it from the
  // Team page. Never fails the request itself over email delivery.
  try {
    const teammates = await db.select({ email: users.email }).from(users).where(eq(users.teamId, teamId));
    if (teammates.length > 0) {
      await sendEmail({
        to: teammates.map((t) => t.email),
        subject: `${name} wants to join your team on Anchor`,
        html: `<p><strong>${name}</strong> (${email}) asked to join ${team.name} on Anchor, for <strong>${dealName}</strong>.</p><p>Review it on your Team page: <a href="${process.env.AUTH_URL}/dashboard/team">${process.env.AUTH_URL}/dashboard/team</a></p>`,
      });
    }
  } catch (err) {
    console.error("Join-request notification email failed:", err);
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
