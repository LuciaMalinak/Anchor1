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
  //
  // Restricted-to-one-deal viewers deliberately never call
  // getTeamInsights at all (see the comment above) — that's an
  // intentional "nothing to show", not a failure, so it has to be
  // tracked separately from a real fetch error. Both used to collapse
  // into the same `initial === null` on the client, which made
  // InsightsClient show a red "Couldn't load insights" error on a
  // restricted teammate's very first page load even though nothing had
  // actually gone wrong — clicking Refresh "fixed" it only because
  // Refresh always clears the error, not because anything was retried.
  let initial: { insights: { patterns: string[]; atRisk: { dealName: string; reason: string }[]; commonThemes: string[] }; dealCount: number } | null = null;
  let loadFailed = false;
  const restricted = Boolean(viewer?.restrictedToDeals);
  if (!restricted) {
    try {
      initial = await getTeamInsights(teamId);
    } catch {
      loadFailed = true;
    }
  }

  return (
    <InsightsClient
      initialInsights={initial?.insights ?? null}
      initialDealCount={initial?.dealCount ?? 0}
      initialLoadFailed={loadFailed}
      restricted={restricted}
    />
  );
}
