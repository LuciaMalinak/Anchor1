import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { supportRequests, users } from "@/db/schema";
import { logAdminAccess, requireAppOwnerApi } from "@/lib/adminAccess";
import { SUPPORT_STATUSES, type SupportStatus } from "@/lib/support";

// The app owner moving a support request along: "in_progress" when they
// start helping (recorded in the admin access log, since it usually means
// connecting to that person's screen), "resolved" when done, or back to
// "open".
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAppOwnerApi();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const status = body.status as SupportStatus;
  if (!SUPPORT_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  }

  const [request] = await db
    .update(supportRequests)
    .set({
      status,
      updatedAt: new Date(),
      resolvedAt: status === "resolved" ? new Date() : null,
    })
    .where(eq(supportRequests.id, id))
    .returning();
  if (!request)
    return NextResponse.json({ error: "Request not found" }, { status: 404 });

  if (status === "in_progress") {
    const [owner] = await db
      .select({ teamId: users.teamId })
      .from(users)
      .where(eq(users.id, request.userId));
    if (owner?.teamId)
      await logAdminAccess(admin.id, owner.teamId, `support:${id}`);
  }
  return NextResponse.json({ request });
}
