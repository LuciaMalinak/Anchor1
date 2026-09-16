import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateTeamId } from "@/lib/team";
import { getTeamInsights } from "@/lib/insights";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);

  try {
    const { insights, dealCount } = await getTeamInsights(teamId);
    return NextResponse.json({ insights, dealCount });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't generate insights right now" },
      { status: 502 }
    );
  }
}
