import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { getTeamInsights } from "@/lib/insights";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);

  // Insights are generated across every deal on the team — someone
  // restricted to just one deal (see src/lib/dealAccess.ts) shouldn't get
  // patterns/risk analysis drawn from deals they can't otherwise open.
  const [viewer] = await db.select().from(users).where(eq(users.id, session.user.id));
  if (viewer?.restrictedToDeals) {
    return NextResponse.json({
      insights: { patterns: [], atRisk: [], commonThemes: [] },
      dealCount: 0,
      restricted: true,
    });
  }

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
