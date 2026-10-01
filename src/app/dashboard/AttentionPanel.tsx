import Link from "next/link";
import { getAttentionItems } from "@/lib/attention";
import { HEALTH_LABEL, HEALTH_DOT_CLASSES } from "@/lib/dealHealth";

// Everything here is read-only and computed on the fly (see
// lib/attention.ts) — no notifications table, nothing to mark as read.
// It's meant to answer "anything need a look before I dive in?" in one
// glance, not to be a full inbox.
export async function AttentionPanel({ teamId, userId }: { teamId: string; userId: string }) {
  const { staleDeals, stuckMeetings } = await getAttentionItems({ teamId, userId });

  if (staleDeals.length === 0 && stuckMeetings.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-slate-200 border-l-4 border-l-amber-400 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-medium text-slate-900">Needs attention</h2>
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
          <Link
            key={d.id}
            href={`/dashboard/deals/${d.id}`}
            className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm transition hover:border-slate-200"
          >
            <span className="flex items-center gap-2 text-slate-700">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${HEALTH_DOT_CLASSES[d.health]}`} aria-hidden="true" />
              <span className="font-medium text-slate-900">{d.name}</span>
              <span className="text-slate-400">
                — {d.stage}, no activity in {d.daysSince} day{d.daysSince === 1 ? "" : "s"}
              </span>
            </span>
            <span className="shrink-0 text-xs font-medium text-slate-500">
              {HEALTH_LABEL[d.health]} →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
