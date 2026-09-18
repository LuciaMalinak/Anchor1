"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { IndustryTicker } from "./IndustryTicker";

// Deal detail pages (/dashboard/deals/<id>) already show their own
// deal-specific news sidebar inside DealTabs — this general, team-wide
// briefing only makes sense everywhere else ("the main site"), so it
// hides itself there rather than doubling up two news panels.
function isDealDetailPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/dashboard\/deals\/[^/]+$/.test(pathname);
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

export function GeneralNewsSidebar({
  initialDailyBriefing,
  initialBriefingUpdatedAt,
  initialTickerItems,
  industryLabel,
}: {
  initialDailyBriefing: string | null;
  initialBriefingUpdatedAt: string | null;
  initialTickerItems: string[];
  industryLabel: string | null;
}) {
  const pathname = usePathname();
  const [dailyBriefing, setDailyBriefing] = useState(initialDailyBriefing);
  const [briefingUpdatedAt, setBriefingUpdatedAt] = useState(initialBriefingUpdatedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isDealDetailPath(pathname)) return null;

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/team/briefing", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't refresh today's briefing");
      setDailyBriefing(body.dailyBriefing);
      setBriefingUpdatedAt(body.dailyBriefingUpdatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't refresh today's briefing");
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="flex w-full flex-col gap-4 lg:w-80 lg:shrink-0">
      <div className="flex items-center gap-2 px-1">
        <LiveDot />
        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold tracking-[0.15em] text-accent">
          NEWS
        </span>
      </div>

      <IndustryTicker initialItems={initialTickerItems} industryLabel={industryLabel} />

      <div className="rounded-lg border border-slate-200 border-l-4 border-l-brand bg-white px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-brand">
            TODAY&apos;S BRIEFING
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="shrink-0 text-xs font-medium text-brand hover:underline disabled:opacity-50"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
        {dailyBriefing ? (
          <>
            <p className="mt-1 text-sm text-slate-700">{dailyBriefing}</p>
            {briefingUpdatedAt && (
              <p className="mt-1 text-[11px] text-slate-400">
                {new Date(briefingUpdatedAt).toLocaleDateString()}
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-400">
            A roundup of today&apos;s business news, shared across your team.
          </p>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>

      <p className="px-1 text-[11px] text-slate-400">
        The ticker above refreshes itself every few minutes; the briefing below updates automatically
        through the day, or hit Refresh any time. Open a deal to see news specific to that company
        instead.
      </p>
    </aside>
  );
}
