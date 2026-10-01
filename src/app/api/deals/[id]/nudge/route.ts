import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { authorizeDeal } from "@/lib/dealAccess";
import { buildDealToolContext } from "@/lib/dealToolContext";
import { draftNudgeEmail } from "@/lib/dealTools";
import { daysSinceActivity } from "@/lib/dealHealth";

// "Draft a nudge" for a deal that's gone quiet (Home > Needs attention).
// Returns a draft only; nothing is sent. Saving it to Gmail goes through
// /api/deals/[id]/gmail-draft once the user has reviewed it.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  const authorized = await authorizeDeal(session.user.id, id);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const { deal } = authorized;

  try {
    const { context, lastMeetingAt } = await buildDealToolContext(deal);
    const draft = await draftNudgeEmail({
      dealName: deal.name,
      daysQuiet: daysSinceActivity({ lastActivityAt: lastMeetingAt, createdAt: deal.createdAt }),
      senderName: session.user.name || session.user.email || "the sender",
      recipientName: deal.primaryContactName,
      context,
    });
    return NextResponse.json({
      draft,
      recipientEmails: deal.primaryContactEmail ? [deal.primaryContactEmail] : [],
    });
  } catch (err) {
    console.error("[nudge]", err);
    return NextResponse.json({ error: "Couldn't draft the nudge. Try again." }, { status: 502 });
  }
}
