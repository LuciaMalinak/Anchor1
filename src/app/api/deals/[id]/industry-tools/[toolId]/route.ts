import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { authorizeDeal } from "@/lib/dealAccess";
import { runIndustryTool, teamToolContext } from "@/lib/industryToolRun";
import { withAiUser } from "@/lib/aiUsage";

// A long report on a deal with many calls can take a minute or more.
export const maxDuration = 300;

// Writes (or rewrites) one industry tool's report for this deal and saves
// it on the deal.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; toolId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id, toolId } = await params;
  const authorized = await authorizeDeal(session.user.id, id);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const tool = (await teamToolContext(authorized.deal.teamId)).tools.find((t) => t.id === toolId);
  if (!tool) {
    return NextResponse.json({ error: "That tool isn't available for this team" }, { status: 404 });
  }
  try {
    const saved = await withAiUser({ userId: session.user.id }, () => runIndustryTool(authorized.deal, tool));
    return NextResponse.json(saved);
  } catch (err) {
    console.error(`[industry tools] ${toolId}`, err);
    return NextResponse.json({ error: "Couldn't write the report. Try again." }, { status: 502 });
  }
}
