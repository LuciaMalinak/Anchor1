import { NextRequest, NextResponse } from "next/server";
import { manageSubscription, parseSubscriptionAction } from "@/lib/billing";
import { billingContext } from "@/lib/billingRequest";

// The team owner changing their own subscription from the Billing page:
// switch plan, pause or resume billing, cancel or keep it. Cancelling
// straight away is Admin only (/api/admin/billing).
export async function POST(req: NextRequest) {
  const ctx = await billingContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!ctx.canManage) return NextResponse.json({ error: "Only your team's owner can change the subscription." }, { status: 403 });
  const change = parseSubscriptionAction((await req.json().catch(() => ({}))) as Record<string, unknown>);
  if (!change || change.action === "cancel-now") return NextResponse.json({ error: "Unknown change" }, { status: 400 });
  try {
    await manageSubscription(ctx.team, change);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[billing] manage failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change the subscription." }, { status: 502 });
  }
}
