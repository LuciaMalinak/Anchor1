import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { authorizeDeal } from "@/lib/dealAccess";
import { teamToolContext } from "@/lib/industryToolRun";

// The tools this deal's team gets (its own specialty's first, then its
// industry's, then the ones for everyone) and the latest report saved for
// each.
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
  const { industry, specialty, tools } = await teamToolContext(authorized.deal.teamId);
  return NextResponse.json({
    industry,
    specialty: specialty ? { sectorName: specialty.sectorName, companyName: specialty.companyName } : null,
    tools: tools.map((t) => ({
      id: t.id,
      name: t.name,
      outcome: t.outcome,
      phase: t.phase,
      kind: t.kind,
      clientFacing: Boolean(t.clientFacing),
      custom: Boolean(t.custom),
      all: t.industries === "all",
    })),
    hasContactEmail: Boolean(authorized.deal.primaryContactEmail),
    reports: authorized.deal.toolReports ?? {},
  });
}
