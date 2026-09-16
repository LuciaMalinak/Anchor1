import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { getDailyBriefing } from "@/lib/dailyBriefing";

// Manual refresh for the team-wide "Today's briefing" shown on the News
// tab. Auto-refresh (throttled to once a day) happens in the deal page
// server component — this route is what the "Refresh" button calls.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);

  let dailyBriefing: string;
  try {
    dailyBriefing = await getDailyBriefing();
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
