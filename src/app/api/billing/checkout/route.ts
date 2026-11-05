import { NextRequest, NextResponse } from "next/server";
import { billingConfigured, checkPromo, createCheckout, hasAccess, type Plan } from "@/lib/billing";
import { baseUrl, billingContext } from "@/lib/billingRequest";

// Starts Stripe Checkout for the team owner: the plan they picked, the
// team's current size, and a free trial if their promo code is good.
export async function POST(req: NextRequest) {
  const ctx = await billingContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!ctx.canManage) {
    return NextResponse.json({ error: "Only your team's owner can set up the subscription." }, { status: 403 });
  }
  if (!billingConfigured()) return NextResponse.json({ error: "Payments aren't set up yet. Please contact sales." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { plan?: string; promoCode?: string };
  const plan: Plan = body.plan === "pro" ? "pro" : "team";
  if (ctx.team.stripeSubscriptionId && hasAccess({ billingExempt: false, billingStatus: ctx.team.billingStatus })) {
    return NextResponse.json({ error: "Your team already has a subscription. Use Manage billing to change it." }, { status: 409 });
  }
  let promo: { code: string; trialDays: number } | null = null;
  if (body.promoCode?.trim()) {
    const check = await checkPromo(body.promoCode, ctx.team);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    promo = { code: check.code, trialDays: check.trialDays };
  }
  try {
    const url = await createCheckout({ team: ctx.team, plan, email: ctx.user.email, name: ctx.user.name, promo, baseUrl: baseUrl(req) });
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[billing] checkout failed:", err);
    return NextResponse.json({ error: "Couldn't open the payment page. Try again in a moment." }, { status: 502 });
  }
}
