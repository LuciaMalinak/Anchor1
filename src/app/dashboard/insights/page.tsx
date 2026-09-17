import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { getTeamInsights } from "@/lib/insights";
import { InsightsClient } from "./InsightsClient";

export default async function InsightsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const teamId = await getOrCreateTeamId(session.user.id);

  // Insights are generated across every deal on the team — someone
  // restricted to just one deal (see src/lib/dealAccess.ts) shouldn't get
  // patterns/risk analysis drawn from deals they can't otherwise open.
  const [viewer] = await db.select().from(users).where(eq(users.id, session.user.id));

  // Best-effort on first render — if the model call fails, hand the
  // client an empty state and let the Refresh button retry rather than
  // breaking the whole page.
  let initial: { insights: { patterns: string[]; atRisk: { dealName: string; reason: string }[]; commonThemes: string[] }; dealCount: number } | null = null;
  if (!viewer?.restrictedToDeals) {
    try {
      initial = await getTeamInsights(teamId);
    } catch {
      initial = null;
    }
  }

  return (
    <InsightsClient
      initialInsights={initial?.insights ?? null}
      initialDealCount={initial?.dealCount ?? 0}
    />
  );
}
