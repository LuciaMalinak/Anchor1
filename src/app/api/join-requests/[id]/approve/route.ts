import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { joinRequests, deals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createInviteAndNotify } from "@/lib/team";
import { canApproveForDeal } from "@/lib/joinRequestAccess";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  // The request's own team decides authorization here — NOT the acting
  // user's team, since the app owner needs to be able to approve a
  // request for a team she isn't even a member of.
  const [request] = await db.select().from(joinRequests).where(eq(joinRequests.id, id));
  if (!request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (request.status !== "pending") {
    return NextResponse.json({ error: "Already decided" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const dealId = typeof body.dealId === "string" ? body.dealId : "";
  const [deal] = dealId ? await db.select().from(deals).where(eq(deals.id, dealId)) : [];
  if (!deal || deal.teamId !== request.teamId) {
    return NextResponse.json({ error: "Pick which deal to grant access to" }, { status: 400 });
  }

  const allowed = await canApproveForDeal(session.user.id, session.user.email, request.teamId, deal.id);
  if (!allowed) {
    return NextResponse.json(
      { error: "Only the team owner or that deal's lead can approve this" },
      { status: 403 }
    );
  }

  const { emailWarning } = await createInviteAndNotify({
    teamId: request.teamId,
    email: request.email,
    invitedByUserId: session.user.id,
    invitedByEmail: session.user.email!,
    restrictToDealId: deal.id,
  });

  await db
    .update(joinRequests)
    .set({
      status: "approved",
      matchedDealId: deal.id,
      decidedByUserId: session.user.id,
      decidedAt: new Date(),
    })
    .where(eq(joinRequests.id, id));

  return NextResponse.json({ ok: true, emailWarning });
}
