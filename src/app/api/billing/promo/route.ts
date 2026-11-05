import { NextRequest, NextResponse } from "next/server";
import { checkPromo } from "@/lib/billing";
import { billingContext } from "@/lib/billingRequest";

// Checks a promo code before checkout, so the page can show "7 days free".
export async function POST(req: NextRequest) {
  const ctx = await billingContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const check = await checkPromo(body.code ?? "", ctx.team);
  return NextResponse.json(check, { status: check.ok ? 200 : 400 });
}
