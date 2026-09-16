import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { researchCompany } from "@/lib/companyResearch";

async function authorizeDeal(userId: string, dealId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal || !user?.teamId || deal.teamId !== user.teamId) return null;
  return deal;
}

// On-demand: looks up public info about the company this deal is with,
// via web search — never about a specific person. See src/lib/companyResearch.ts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const deal = await authorizeDeal(session.user.id, dealId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

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
