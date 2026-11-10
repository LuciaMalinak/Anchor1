import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens, integrationConnections, memberLastSeen, sessions, users } from "@/db/schema";
import { teamOwnerContext } from "@/lib/teamOwner";
import { logDataChange } from "@/lib/dataChangeLog";

// Team owner's view of who can get into the team's data and how: each
// member's two-step verification, connected services, desktop app and
// signed-in devices, plus "sign out everywhere" for someone who's left or
// lost a device.
export async function GET() {
  const ctx = await teamOwnerContext();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const members = await db
    .select({ id: users.id, name: users.name, email: users.email, twoFactorEnabledAt: users.twoFactorEnabledAt })
    .from(users)
    .where(eq(users.teamId, ctx.team.id));
  const ids = members.map((m) => m.id);
  const [conns, tokens, sess, seen] = ids.length
    ? await Promise.all([
        db.select({ userId: integrationConnections.userId, provider: integrationConnections.provider }).from(integrationConnections).where(inArray(integrationConnections.userId, ids)),
        db.select({ userId: apiTokens.userId, lastUsedAt: apiTokens.lastUsedAt }).from(apiTokens).where(inArray(apiTokens.userId, ids)),
        db.select({ userId: sessions.userId, expires: sessions.expires }).from(sessions).where(inArray(sessions.userId, ids)),
        db.select().from(memberLastSeen).where(inArray(memberLastSeen.userId, ids)),
      ])
    : [[], [], [], []];
  const now = Date.now();
  return NextResponse.json({
    requireTwoFactor: ctx.team.requireTwoFactor,
    members: members
      .filter((m) => !m.email?.endsWith("@anchor.invalid"))
      .map((m) => {
        const desktop = tokens.filter((t) => t.userId === m.id);
        const lastDesktop = desktop.map((t) => t.lastUsedAt?.getTime() ?? 0).sort((a, b) => b - a)[0];
        return {
          id: m.id,
          name: m.name,
          email: m.email,
          isOwner: m.id === ctx.team.ownerUserId,
          twoFactor: Boolean(m.twoFactorEnabledAt),
          connections: [...new Set(conns.filter((c) => c.userId === m.id).map((c) => c.provider))],
          desktopApp: desktop.length ? (lastDesktop ? new Date(lastDesktop).toISOString() : "never used") : null,
          signedInSessions: sess.filter((s) => s.userId === m.id && s.expires.getTime() > now).length,
          lastSeen: seen.find((s) => s.userId === m.id)?.lastSeenAt?.toISOString() ?? null,
        };
      }),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await teamOwnerContext();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const body = (await req.json().catch(() => ({}))) as { action?: string; userId?: string };
  if (body.action !== "sign-out" || !body.userId) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const [member] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, body.userId), eq(users.teamId, ctx.team.id)));
  if (!member) return NextResponse.json({ error: "That person isn't on your team." }, { status: 404 });
  // Every browser sign-in and the desktop app's connection. They can sign
  // in again only if they still have access to their email or account.
  const ended = await db.delete(sessions).where(eq(sessions.userId, member.id)).returning({ t: sessions.sessionToken });
  const apps = await db.delete(apiTokens).where(eq(apiTokens.userId, member.id)).returning({ id: apiTokens.id });
  await logDataChange({
    action: "member_signed_out",
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email,
    teamId: ctx.team.id,
    targetId: member.id,
    details: { sessions: ended.length, desktopApps: apps.length },
  });
  return NextResponse.json({ ok: true, sessions: ended.length, desktopApps: apps.length });
}
