import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { dataChangeLog, dealMembers, deals, teams, users } from "@/db/schema";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { logDataChange } from "@/lib/dataChangeLog";
import { restoreDeal, trashTeamId } from "@/lib/dataSafety";
import { lastBackup } from "@/lib/backup";
import { isR2Configured } from "@/lib/r2";

// Admin → Data safety: find a person and see where their deals are, move
// someone back onto a team, restore deleted deals, and the backup status.
export async function GET(req: NextRequest) {
  const admin = await requireAppOwnerApi();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const trash = await trashTeamId();

  let people: unknown[] = [];
  if (q.length >= 2) {
    const found = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        teamId: users.teamId,
        restrictedToDeals: users.restrictedToDeals,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`)))
      .limit(20);
    people = await Promise.all(
      found.map(async (u) => {
        const [team] = u.teamId ? await db.select({ id: teams.id, name: teams.name, ownerUserId: teams.ownerUserId }).from(teams).where(eq(teams.id, u.teamId)) : [];
        const [teamDeals] = u.teamId
          ? await db.select({ n: sql<number>`count(*)` }).from(deals).where(eq(deals.teamId, u.teamId))
          : [{ n: 0 }];
        // Every deal this person created, wherever it is now.
        const created = await db
          .select({ id: deals.id, name: deals.name, stage: deals.stage, teamId: deals.teamId, teamName: teams.name })
          .from(deals)
          .leftJoin(teams, eq(teams.id, deals.teamId))
          .where(eq(deals.createdByUserId, u.id))
          .orderBy(desc(deals.createdAt))
          .limit(200);
        const grants = await db.select({ dealId: dealMembers.dealId }).from(dealMembers).where(eq(dealMembers.userId, u.id));
        const history = await db
          .select()
          .from(dataChangeLog)
          .where(or(eq(dataChangeLog.targetId, u.id), eq(dataChangeLog.actorUserId, u.id)))
          .orderBy(desc(dataChangeLog.createdAt))
          .limit(30);
        return {
          ...u,
          team: team ? { ...team, isOwner: team.ownerUserId === u.id, dealCount: Number(teamDeals?.n ?? 0) } : null,
          dealGrants: grants.length,
          createdDeals: created.map((d) => ({ ...d, deleted: d.teamId === trash, onOtherTeam: d.teamId !== u.teamId && d.teamId !== trash })),
          history,
        };
      }),
    );
  }

  const deleted = await db
    .select({ id: deals.id, name: deals.name, stage: deals.stage, createdAt: deals.createdAt })
    .from(deals)
    .where(eq(deals.teamId, trash))
    .orderBy(desc(deals.createdAt))
    .limit(100);
  const deletedLog = deleted.length
    ? await db
        .select()
        .from(dataChangeLog)
        .where(and(eq(dataChangeLog.action, "deal_deleted"), inArray(dataChangeLog.targetId, deleted.map((d) => d.id))))
    : [];
  const recent = await db.select().from(dataChangeLog).orderBy(desc(dataChangeLog.createdAt)).limit(50);
  const allTeams = await db
    .select({ id: teams.id, name: teams.name, ownerEmail: users.email })
    .from(teams)
    .leftJoin(users, eq(users.id, teams.ownerUserId))
    .where(sql`${teams.id} <> ${trash}`)
    .orderBy(teams.name);

  return NextResponse.json({
    people,
    deleted: deleted.map((d) => {
      const log = deletedLog.find((l) => l.targetId === d.id);
      return { ...d, deletedAt: log?.createdAt ?? null, deletedBy: log?.actorEmail ?? null, fromTeamId: log?.teamId ?? null };
    }),
    recent,
    teams: allTeams,
    backup: { configured: isR2Configured(), last: await lastBackup().catch(() => null) },
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAppOwnerApi();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; userId?: string; teamId?: string; dealId?: string; fullAccess?: boolean };

  if (body.action === "move") {
    const [user] = await db.select().from(users).where(eq(users.id, String(body.userId ?? "")));
    const [team] = await db.select().from(teams).where(eq(teams.id, String(body.teamId ?? "")));
    if (!user || !team || team.id === (await trashTeamId())) return NextResponse.json({ error: "Person or team not found." }, { status: 404 });
    await db
      .update(users)
      .set({ teamId: team.id, ...(body.fullAccess ? { restrictedToDeals: false } : {}) })
      .where(eq(users.id, user.id));
    await logDataChange({
      action: "user_moved",
      actorUserId: admin.id,
      actorEmail: admin.email,
      teamId: team.id,
      targetId: user.id,
      details: { email: user.email, fromTeamId: user.teamId, toTeamId: team.id, toTeamName: team.name, fullAccess: Boolean(body.fullAccess) },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "restoreDeal") {
    const result = await restoreDeal(String(body.dealId ?? ""));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    await logDataChange({ action: "deal_restored", actorUserId: admin.id, actorEmail: admin.email, teamId: result.teamId, targetId: body.dealId });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "backupNow") {
    const { runBackup } = await import("@/lib/backup");
    const result = await runBackup();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export const maxDuration = 300;
