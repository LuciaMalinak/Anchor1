import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { getDailyBriefing } from "@/lib/dailyBriefing";
import { isIndustryKey } from "@/lib/industries";

// Cheap read of whatever's already cached — no AI call, never blocks.
// The dashboard layout kicks off a background refresh (fire-and-forget,
// same pattern as the industry ticker) whenever the briefing is stale
// rather than awaiting it, so the first page load after a long gap
// renders immediately instead of freezing on a web-search call; this is
// what GeneralNewsSidebar polls to pick up that result once it lands.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));

  return NextResponse.json({
    dailyBriefing: team?.dailyBriefing ?? null,
    dailyBriefingUpdatedAt: team?.dailyBriefingUpdatedAt ?? null,
  });
}

// Manual refresh for the team-wide "Today's briefing" shown on the News
// tab — this is what the "Refresh" button calls, and does trigger a real
// (slower) AI lookup, unlike GET above.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  const industry = team?.industry && isIndustryKey(team.industry) ? team.industry : null;

  let dailyBriefing: string;
  try {
    dailyBriefing = await getDailyBriefing(industry);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't refresh today's briefing" },
      { status: 500 }
    );
  }

  const dailyBriefingUpdatedAt = new Date();
  await db.update(teams).set({ dailyBriefing, dailyBriefingUpdatedAt }).where(eq(teams.id, teamId));

  return NextResponse.json({ dailyBriefing, dailyBriefingUpdatedAt });
}
