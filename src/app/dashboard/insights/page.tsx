import { auth } from "@/auth";
import { getOrCreateTeamId } from "@/lib/team";
import { getTeamInsights } from "@/lib/insights";
import { InsightsClient } from "./InsightsClient";

export default async function InsightsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const teamId = await getOrCreateTeamId(session.user.id);

  // Best-effort on first render — if the model call fails, hand the
  // client an empty state and let the Refresh button retry rather than
  // breaking the whole page.
  let initial: { insights: { patterns: string[]; atRisk: { dealName: string; reason: string }[]; commonThemes: string[] }; dealCount: number } | null = null;
  try {
    initial = await getTeamInsights(teamId);
  } catch {
    initial = null;
  }

  return (
    <InsightsClient
      initialInsights={initial?.insights ?? null}
      initialDealCount={initial?.dealCount ?? 0}
    />
  );
}
