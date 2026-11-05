import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { promoCodes, salesLeads, teams, users } from "@/db/schema";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { billingConfigured, normalizeCode } from "@/lib/billing";

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
        billingExempt: teams.billingExempt,
        billingStatus: teams.billingStatus,
        billingPlan: teams.billingPlan,
        billingSeats: teams.billingSeats,
        trialEndsAt: teams.trialEndsAt,
        promoCodeUsed: teams.promoCodeUsed,
        createdAt: teams.createdAt,
      })
      .from(teams)
      .leftJoin(users, eq(users.id, teams.ownerUserId))
      .orderBy(desc(teams.createdAt)),
  ]);
  return NextResponse.json({ configured: billingConfigured(), codes, leads, teams: teamRows });
}

export async function POST(req: NextRequest) {
  if (!(await requireAppOwnerApi())) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
