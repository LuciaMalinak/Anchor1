import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, users, dealMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DEAL_STAGES } from "@/lib/dealStages";
import { authorizeDeal } from "@/lib/dealAccess";

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
  if (typeof body.restricted === "boolean") {
    updates.restricted = body.restricted;
  }

  // The full list of who this deal should be limited to, when it's
  // restricted (or being restricted by this same request) — anyone NOT
  // in this list loses access, so every id is checked against the team
  // before anything is written. Optional: a request can turn restriction
  // on without touching the list (nothing named besides the people who
  // are always included below), or update the list on an
  // already-restricted deal without resending `restricted`.
  let sharedWithUserIds: string[] | undefined;
  if (Array.isArray(body.sharedWithUserIds)) {
    const ids = body.sharedWithUserIds.filter((v: unknown): v is string => typeof v === "string");
    for (const uid of ids) {
      if (!(await isOnTeam(teamId, uid))) {
        return NextResponse.json({ error: "Not a valid team member" }, { status: 400 });
      }
    }
    sharedWithUserIds = ids;
  }

  if (Object.keys(updates).length === 0 && sharedWithUserIds === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(deals)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(deals.id, dealId))
    .returning();

  // Whenever the deal ends up restricted, keep dealMembers in sync with
  // who should be able to see it — creator, lead, backup, and whoever's
  // making this change always keep access even if they weren't named in
  // sharedWithUserIds, so restricting a deal can never accidentally lock
  // out the person who just set it up.
  if (updated.restricted && (updates.restricted === true || sharedWithUserIds !== undefined)) {
    const alwaysIncluded = [
      updated.createdByUserId,
      updated.leadUserId,
      updated.backupUserId,
      session.user.id,
    ].filter((v): v is string => Boolean(v));
    const finalMembers = Array.from(new Set([...(sharedWithUserIds ?? []), ...alwaysIncluded]));

    await db.delete(dealMembers).where(eq(dealMembers.dealId, dealId));
    if (finalMembers.length > 0) {
      await db.insert(dealMembers).values(finalMembers.map((userId) => ({ dealId, userId })));
    }
  }

  return NextResponse.json({ deal: updated });
}
