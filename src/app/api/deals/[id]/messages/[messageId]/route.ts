import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { dealMessages } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authorizeDeal } from "@/lib/dealAccess";

// Sender-only — nothing else in this app lets you erase something a
// teammate wrote (compare: files can be removed by anyone who can see
// the deal, since those are shared deal assets, not authored speech).
// Deliberately no edit endpoint alongside this — delete-and-resend is
// simpler than tracking "edited" state for a chat this lightweight.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId, messageId } = await params;
  const authorized = await authorizeDeal(session.user.id, dealId);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const [message] = await db
    .select()
    .from(dealMessages)
    .where(and(eq(dealMessages.id, messageId), eq(dealMessages.dealId, dealId)));
  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  if (message.userId !== session.user.id) {
    return NextResponse.json({ error: "You can only delete your own messages" }, { status: 403 });
  }

  await db.delete(dealMessages).where(eq(dealMessages.id, messageId));

  return NextResponse.json({ ok: true });
}
