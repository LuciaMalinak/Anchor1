import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { authorizeDeal } from "@/lib/dealAccess";
import { buildDealToolContext } from "@/lib/dealToolContext";
import { writePreCallBrief } from "@/lib/dealTools";

// The pre-call brief on a deal's Before tab: where things stand, who
// matters, what's still open, what to ask and what to watch out for.
// Generated on request and not stored.
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
  try {
    const { context } = await buildDealToolContext(authorized.deal);
    const brief = await writePreCallBrief({ dealName: authorized.deal.name, context });
    return NextResponse.json({ brief, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[brief]", err);
    return NextResponse.json({ error: "Couldn't write the brief. Try again." }, { status: 502 });
  }
}
