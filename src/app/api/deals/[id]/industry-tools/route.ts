import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { authorizeDeal } from "@/lib/dealAccess";
import { isIndustryKey } from "@/lib/industries";
import { toolsForIndustry } from "@/lib/industryTools";

// The industry tools this deal's team gets (its industry's, plus the ones
// for everyone) and the latest report saved for each.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  const authorized = await authorizeDeal(session.user.id, id);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const [team] = await db.select({ industry: teams.industry }).from(teams).where(eq(teams.id, authorized.deal.teamId));
  const industry = team?.industry && isIndustryKey(team.industry) ? team.industry : null;
  return NextResponse.json({
    industry,
    tools: toolsForIndustry(industry).map((t) => ({ id: t.id, name: t.name, outcome: t.outcome, phase: t.phase, all: t.industries === "all" })),
    reports: authorized.deal.toolReports ?? {},
  });
}
