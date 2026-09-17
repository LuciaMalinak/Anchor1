import Link from "next/link";
import type { HomeUpdate } from "@/lib/homeFeed";

const KIND_LABEL: Record<HomeUpdate["kind"], string> = {
  team: "Team",
  deal: "Deal",
};

const KIND_CLASSES: Record<HomeUpdate["kind"], string> = {
  team: "bg-slate-100 text-slate-600",
  deal: "bg-brand/10 text-brand",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Read-only, server-rendered — nothing here needs client interactivity,
// so it stays out of the JS bundle entirely. Market news has its own
// panel already (the daily briefing in the layout sidebar); this is
// team + deal activity instead.
export function HomeUpdates({ updates }: { updates: HomeUpdate[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-medium text-slate-900">Latest updates</h2>
      <p className="text-xs text-slate-500">What&apos;s happened across your team and deals.</p>

      <div className="mt-4 flex flex-col gap-3">
        {updates.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing yet — this fills in as your team gets moving.</p>
        ) : (
          updates.map((u) => (
            <Link
              key={u.id}
              href={u.href}
              className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition hover:bg-slate-50"
            >
              <span className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_CLASSES[u.kind]}`}
                >
                  {KIND_LABEL[u.kind]}
                </span>
                <span className="text-slate-700">{u.text}</span>
              </span>
              <span className="shrink-0 text-xs text-slate-400">{timeAgo(u.at)}</span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
