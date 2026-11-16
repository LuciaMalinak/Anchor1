import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { promoCodes, salesLeads, teams, users } from "@/db/schema";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { anonymizeAccount } from "@/lib/deleteAccount";
import { logDataChange } from "@/lib/dataChangeLog";
import { APP_OWNER_EMAILS, isAppOwner } from "@/lib/appOwner";
import { billingConfigured, manageSubscription, normalizeCode, parseSubscriptionAction } from "@/lib/billing";

// Admin → Billing: promo codes, free accounts, sales requests.
export async function GET() {
  if (!(await requireAppOwnerApi())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [codes, leads, teamRows] = await Promise.all([
    db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)),
    db.select().from(salesLeads).orderBy(desc(salesLeads.createdAt)).limit(100),
    db
      .select({
        id: teams.id,
        name: teams.name,
        ownerEmail: users.email,
        ownerName: users.name,
        freeUntil: teams.freeUntil,
        members: sql<number>`(select count(*)::int from "user" u where u."teamId" = ${teams.id} and u.email not like 'deleted-%@anchor.invalid')`,
        billingExempt: teams.billingExempt,
        billingStatus: teams.billingStatus,
        billingPlan: teams.billingPlan,
        billingSeats: teams.billingSeats,
        trialEndsAt: teams.trialEndsAt,
        promoCodeUsed: teams.promoCodeUsed,
        hasSubscription: teams.stripeSubscriptionId,
        currentPeriodEnd: teams.currentPeriodEnd,
        billingCancelAt: teams.billingCancelAt,
        billingPausedAt: teams.billingPausedAt,
        billingResumesAt: teams.billingResumesAt,
        createdAt: teams.createdAt,
      })
      .from(teams)
      .leftJoin(users, eq(users.id, teams.ownerUserId))
      .orderBy(desc(teams.createdAt)),
  ]);
  // The app owner's own team(s): never offered for deletion.
  const ownerTeams = new Set(
    (await db.select({ teamId: users.teamId }).from(users).where(inArray(sql`lower(${users.email})`, APP_OWNER_EMAILS)))
      .map((r) => r.teamId)
      .filter(Boolean),
  );
  return NextResponse.json({
    configured: billingConfigured(),
    codes,
    leads,
    // Teams with nobody left on them (every account deleted) aren't clients any more.
    teams: teamRows.filter((t) => t.members > 0).map((t) => ({ ...t, hasSubscription: Boolean(t.hasSubscription), own: ownerTeams.has(t.id) })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAppOwnerApi();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  switch (body.action) {
    case "createPromo": {
      const code = normalizeCode(String(body.code ?? ""));
      const trialDays = Number(body.trialDays);
      const maxUses = body.maxUses === "" || body.maxUses === null || body.maxUses === undefined ? null : Number(body.maxUses);
      if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
        return NextResponse.json({ error: "Codes are 3-40 letters, numbers, - or _." }, { status: 400 });
      }
      if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 730) {
        return NextResponse.json({ error: "Free days must be between 1 and 730." }, { status: 400 });
      }
      if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
        return NextResponse.json({ error: "Max uses must be a whole number, or empty for unlimited." }, { status: 400 });
      }
      const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : null;
      const [row] = await db
        .insert(promoCodes)
        .values({
          code,
          trialDays,
          maxUses,
          note: String(body.note ?? "").trim().slice(0, 200) || null,
          expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) return NextResponse.json({ error: "That code already exists." }, { status: 409 });
      return NextResponse.json({ code: row });
    }
    case "setPromoActive": {
      await db
        .update(promoCodes)
        .set({ active: Boolean(body.active) })
        .where(eq(promoCodes.code, normalizeCode(String(body.code ?? ""))));
      return NextResponse.json({ ok: true });
    }
    case "setTeamExempt": {
      await db
        .update(teams)
        .set({ billingExempt: Boolean(body.exempt) })
        .where(eq(teams.id, String(body.teamId ?? "")));
      return NextResponse.json({ ok: true });
    }
    // Any client's subscription: change plan, pause/resume, cancel (at the
    // period end or straight away) or undo a scheduled cancellation.
    case "subscription": {
      const change = parseSubscriptionAction((body.change ?? {}) as Record<string, unknown>);
      if (!change) return NextResponse.json({ error: "Unknown change" }, { status: 400 });
      const [team] = await db.select().from(teams).where(eq(teams.id, String(body.teamId ?? "")));
      if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
      try {
        await manageSubscription(team, change);
        return NextResponse.json({ ok: true });
      } catch (err) {
        console.error("[admin billing] subscription change failed:", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change the subscription." }, { status: 502 });
      }
    }
    // A free trial for one team, no card needed: full access for N days,
    // then they're asked to choose a plan. days null ends it now.
    case "setFreeTrial": {
      const days = body.days === null ? null : Number(body.days);
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
        return NextResponse.json({ error: "Free trial must be 1 to 365 days." }, { status: 400 });
      }
      const [team] = await db
        .update(teams)
        .set({ freeUntil: days === null ? null : new Date(Date.now() + days * 86_400_000) })
        .where(eq(teams.id, String(body.teamId ?? "")))
        .returning({ id: teams.id, freeUntil: teams.freeUntil });
      if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
      return NextResponse.json({ ok: true, freeUntil: team.freeUntil });
    }
    // Deletes every person's account on a team that isn't paying (sign-ups
    // that never subscribed, ended subscriptions): emails and personal
    // details removed, signed out everywhere. The team's data is kept
    // with nobody on it, so a mistake can be undone from Admin → Data.
    case "deleteAccounts": {
      const [team] = await db.select().from(teams).where(eq(teams.id, String(body.teamId ?? "")));
      if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
      if (team.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(team.billingStatus ?? "")) {
        return NextResponse.json({ error: "This client has an active subscription. Cancel it first (Subscription → Cancel now)." }, { status: 400 });
      }
      const members = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.teamId, team.id));
      if (members.some((m) => isAppOwner(m.email))) {
        return NextResponse.json({ error: "That's your own team, so it can't be deleted here." }, { status: 400 });
      }
      await logDataChange({
        action: "team_deleted",
        actorUserId: admin.id,
        actorEmail: admin.email,
        teamId: team.id,
        targetId: team.id,
        details: { teamName: team.name, reason: "deleted by the app owner from Admin → Billing; team and data kept", emails: members.map((m) => m.email) },
      });
      for (const m of members) {
        await anonymizeAccount(m.id, { userId: admin.id, email: admin.email, reason: "deleted by the app owner from Admin → Billing" });
      }
      await db.update(teams).set({ freeUntil: null }).where(eq(teams.id, team.id));
      return NextResponse.json({ ok: true, deleted: members.length });
    }
    case "setLeadStatus": {
      await db
        .update(salesLeads)
        .set({ status: body.status === "done" ? "done" : "new" })
        .where(eq(salesLeads.id, String(body.leadId ?? "")));
      return NextResponse.json({ ok: true });
    }
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
