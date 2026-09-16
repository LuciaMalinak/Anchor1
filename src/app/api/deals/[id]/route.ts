import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DEAL_STAGES } from "@/lib/dealStages";

async function authorizeDeal(userId: string, dealId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal || !user?.teamId || deal.teamId !== user.teamId) return null;
  return { deal, teamId: user.teamId };
}

// Lead/backup must be null (unassigned) or an actual member of this
// deal's team — never trust a client-supplied id without checking.
async function isOnTeam(teamId: string, userId: string): Promise<boolean> {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return Boolean(row && row.teamId === teamId);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const authorized = await authorizeDeal(session.user.id, dealId);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const { teamId } = authorized;

  const body = await req.json().catch(() => ({}));
  const updates: Partial<typeof deals.$inferInsert> = {};

  if (typeof body.stage === "string") {
    if (!(DEAL_STAGES as readonly string[]).includes(body.stage)) {
      return NextResponse.json({ error: "Not a valid stage" }, { status: 400 });
    }
    updates.stage = body.stage;
  }
  if (typeof body.primaryContactName === "string") {
    updates.primaryContactName = body.primaryContactName.trim() || null;
  }
  if (typeof body.primaryContactRole === "string") {
    updates.primaryContactRole = body.primaryContactRole.trim() || null;
  }
  if (typeof body.primaryContactEmail === "string") {
    updates.primaryContactEmail = body.primaryContactEmail.trim() || null;
  }
  if (typeof body.companyWebsite === "string") {
    updates.companyWebsite = body.companyWebsite.trim() || null;
  }
  if (typeof body.notes === "string") {
    updates.notes = body.notes.trim() || null;
  }
  if (typeof body.decisionBoundaries === "string") {
    updates.decisionBoundaries = body.decisionBoundaries.trim() || null;
  }
  if ("leadUserId" in body) {
    if (body.leadUserId === null) {
      updates.leadUserId = null;
    } else if (typeof body.leadUserId === "string" && (await isOnTeam(teamId, body.leadUserId))) {
      updates.leadUserId = body.leadUserId;
    } else {
      return NextResponse.json({ error: "Not a valid team member" }, { status: 400 });
    }
  }
  if ("backupUserId" in body) {
    if (body.backupUserId === null) {
      updates.backupUserId = null;
    } else if (typeof body.backupUserId === "string" && (await isOnTeam(teamId, body.backupUserId))) {
      updates.backupUserId = body.backupUserId;
    } else {
      return NextResponse.json({ error: "Not a valid team member" }, { status: 400 });
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(deals)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(deals.id, dealId))
    .returning();

  return NextResponse.json({ deal: updated });
}
