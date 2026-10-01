import Link from "next/link";
import { getAttentionItems } from "@/lib/attention";
import { HEALTH_LABEL, HEALTH_DOT_CLASSES } from "@/lib/dealHealth";
import { isProviderConfigured } from "@/lib/integrations/config";
import { NudgeButton } from "@/components/NudgeButton";
import { AskAnchorButton } from "@/components/AskAnchorDock";

// Everything here is read-only and computed on the fly (see
// lib/attention.ts) — no notifications table, nothing to mark as read.
// It answers "anything need a look before I dive in?": calls stuck
// joining, deals going quiet (with a one-click nudge), and promises from
// calls that are still open days later.
export async function AttentionPanel({ teamId, userId }: { teamId: string; userId: string }) {
  const { staleDeals, stuckMeetings, openPromises } = await getAttentionItems({ teamId, userId });
  const googleConfigured = isProviderConfigured("google");

  if (staleDeals.length === 0 && stuckMeetings.length === 0 && openPromises.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-slate-200 border-l-4 border-l-amber-400 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-medium text-slate-900">Needs your attention</h2>
      <p className="mt-0.5 text-xs text-slate-500">Deals going quiet and promises still open from your calls.</p>
      <div className="mt-3 flex flex-col gap-2">
        {stuckMeetings.map((m) => (
          <Link
            key={m.id}
            href={`/dashboard/meetings/${m.id}`}
            className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50 px-4 py-2.5 text-sm transition hover:border-rose-200"
          >
            <span className="text-rose-900">
              <span className="font-medium">{m.title}</span> has been{" "}
              {m.status === "joining" ? "trying to join" : "recording"} for {m.minutesOld} min
            </span>
            <span className="shrink-0 text-xs font-medium text-rose-600">Check it →</span>
          </Link>
        ))}
        {staleDeals.map((d) => (
          <div
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm"
          >
            <Link href={`/dashboard/deals/${d.id}`} className="flex min-w-0 items-center gap-2 text-slate-700 hover:text-brand">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${HEALTH_DOT_CLASSES[d.health]}`} aria-hidden="true" />
              <span className="font-medium text-slate-900">{d.name}</span>
              <span className="text-slate-500">
                — {HEALTH_LABEL[d.health].toLowerCase()}, no call in {d.daysSince} day{d.daysSince === 1 ? "" : "s"}
              </span>
            </Link>
            <div className="flex items-center gap-2">
              <AskAnchorButton question={`Why has ${d.name} gone quiet, and what's the best next move?`}>Ask why</AskAnchorButton>
              <NudgeButton dealId={d.id} dealName={d.name} googleConfigured={googleConfigured} returnTo="/dashboard" />
            </div>
          </div>
        ))}
        {openPromises.map((p) => (
          <Link
            key={p.taskId}
            href={`/dashboard/deals/${p.dealId}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-orange-100 bg-orange-50/60 px-4 py-2.5 text-sm transition hover:border-orange-200"
          >
            <span className="min-w-0 text-slate-700">
              <span className="font-medium text-slate-900">{p.dealName}</span> — promised “{p.text}”
              {p.ownerLabel ? ` (${p.ownerLabel})` : ""}
            </span>
            <span className="shrink-0 text-xs font-medium text-orange-700">Open {p.daysOpen} days →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
