import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { researchCompany } from "@/lib/companyResearch";
import { authorizeDeal } from "@/lib/dealAccess";

// Cheap read of whatever's already cached — no AI call, never blocks.
// The deal page kicks off a background refresh (fire-and-forget) rather
// than awaiting it when research is stale, so this is what the
// "Research" panel polls to pick up that result once it lands, instead
// of the page having frozen on it.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const authorized = await authorizeDeal(session.user.id, dealId);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const { deal } = authorized;

  return NextResponse.json({
    companyResearch: deal.companyResearch,
    newsHeadline: deal.newsHeadline,
    companyResearchUpdatedAt: deal.companyResearchUpdatedAt,
  });
}

// On-demand: looks up public info about the company this deal is with,
// via web search — never about a specific person. See src/lib/companyResearch.ts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const authorized = await authorizeDeal(session.user.id, dealId);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const { deal } = authorized;

  let result: Awaited<ReturnType<typeof researchCompany>>;
  try {
    result = await researchCompany({
      companyName: deal.name,
      companyWebsite: deal.companyWebsite,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't research this company" },
      { status: 500 }
    );
  }

  const companyResearchUpdatedAt = new Date();
  await db
    .update(deals)
    .set({
      companyResearch: result.briefing,
      newsHeadline: result.newsHeadline,
      companyResearchUpdatedAt,
    })
    .where(eq(deals.id, dealId));

  return NextResponse.json({
    companyResearch: result.briefing,
    newsHeadline: result.newsHeadline,
    companyResearchUpdatedAt,
  });
}
