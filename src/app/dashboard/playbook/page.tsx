import { auth } from "@/auth";
import { playbookForTeam } from "@/lib/answerPlaybook";
import { playbookAccess } from "@/lib/playbookAccess";
import { PlaybookClient } from "./PlaybookClient";

// Train Anchor: every answer it has learned from the team's calls or been
// taught, to check, fix, add to or remove. Live answers use these.
export default async function PlaybookPage() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const access = await playbookAccess(session.user.id);
  if (!access) {
    return <p className="text-sm text-slate-500">Join or create a team to start a playbook.</p>;
  }
  const rows = await playbookForTeam(access.teamId, [...access.dealIds]);
  return (
    <PlaybookClient
      deals={access.deals.map((d) => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name))}
      initial={rows.map(({ entry, dealName }) => ({
        id: entry.id,
        question: entry.question,
        answer: entry.answer,
        source: entry.source,
        dealName: dealName ?? null,
        updatedAt: entry.updatedAt.toISOString(),
      }))}
    />
  );
}
