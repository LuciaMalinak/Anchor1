import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { getIndustryTicker, isTickerStale, normalizeTickerItems } from "@/lib/industryTicker";
import { isIndustryKey } from "@/lib/industries";

// Polled every few minutes by IndustryTicker.tsx. Always answers from
// cache immediately; when the cache is stale it kicks off a refresh in
// the background (never awaited) so THIS request stays fast — the next
// poll a few minutes later is what picks up the fresh result. Same
// non-blocking shape as the ticker refresh in dashboard/layout.tsx.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) {
    return NextResponse.json({ items: [], updatedAt: null });
  }

  if (isTickerStale(team.industryTickerUpdatedAt)) {
    const industry = team.industry && isIndustryKey(team.industry) ? team.industry : null;
    getIndustryTicker(industry)
      .then((items) =>
        db
          .update(teams)
          .set({ industryTicker: items, industryTickerUpdatedAt: new Date() })
          .where(eq(teams.id, teamId))
      )
      .catch((err) => console.error("Background ticker refresh failed:", err));
  }

  return NextResponse.json({
    items: normalizeTickerItems(team.industryTicker),
    updatedAt: team.industryTickerUpdatedAt ? team.industryTickerUpdatedAt.toISOString() : null,
  });
}

// Manual refresh, mirroring /api/team/briefing's POST — not currently
// wired to a button anywhere, but here for parity/debugging, and in case
// a "refresh ticker" affordance gets added later.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  const industry = team?.industry && isIndustryKey(team.industry) ? team.industry : null;

  let items: Awaited<ReturnType<typeof getIndustryTicker>>;
  try {
    items = await getIndustryTicker(industry);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't refresh the ticker" },
      { status: 500 }
    );
  }

  const updatedAt = new Date();
  await db.update(teams).set({ industryTicker: items, industryTickerUpdatedAt: updatedAt }).where(eq(teams.id, teamId));
  return NextResponse.json({ items, updatedAt: updatedAt.toISOString() });
}
