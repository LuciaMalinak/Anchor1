import { NextRequest, NextResponse } from "next/server";
import { createPortal } from "@/lib/billing";
import { baseUrl, billingContext } from "@/lib/billingRequest";

// Stripe's own page for the owner to change the card, see invoices or cancel.
export async function POST(req: NextRequest) {
  const ctx = await billingContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!ctx.canManage) return NextResponse.json({ error: "Only your team's owner can manage billing." }, { status: 403 });
  try {
    return NextResponse.json({ url: await createPortal(ctx.team, baseUrl(req)) });
  } catch (err) {
    console.error("[billing] portal failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't open billing." }, { status: 502 });
  }
}
