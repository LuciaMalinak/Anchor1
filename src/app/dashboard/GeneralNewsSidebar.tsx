"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { IndustryTicker } from "./IndustryTicker";
import type { TickerItem } from "@/lib/industryTicker";

// How often to check for the background briefing refresh landing (see
// the dashboard layout — it kicks that off fire-and-forget rather than
// blocking the page). Only polls while there's nothing to show yet, so
// this never runs once a briefing has loaded.
const BRIEFING_POLL_MS = 20 * 1000;

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
  initialTickerItems: TickerItem[];
  industryLabel: string | null;
}) {
  const pathname = usePathname();
  const [dailyBriefing, setDailyBriefing] = useState(initialDailyBriefing);
  const [briefingUpdatedAt, setBriefingUpdatedAt] = useState(initialBriefingUpdatedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dailyBriefing) return; // already have one — nothing to wait on
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/team/briefing");
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        if (!cancelled && body?.dailyBriefing) {
          setDailyBriefing(body.dailyBriefing);
          setBriefingUpdatedAt(body.dailyBriefingUpdatedAt);
        }
      } catch {
        // Ambient background polling — a failed check just means we try
        // again next tick; the placeholder text stays up meanwhile.
      }
    }

    // Check right away instead of waiting a full BRIEFING_POLL_MS first —
    // this component now remounts (fresh, empty state) the moment a team
    // switches industry (see the `key` on GeneralNewsSidebar in layout.tsx),
    // so a prompt first check matters: the background regeneration for the
    // new sector kicks off at the same moment, and often finishes well
    // inside 20s.
    poll();
    const interval = setInterval(poll, BRIEFING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dailyBriefing]);

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
    <aside className="flex w-full flex-col gap-3 lg:w-80 lg:shrink-0">
      <div className="flex items-center gap-2 px-1">
        <LiveDot />
        <span className="eyebrow">News for your team</span>
      </div>

      <IndustryTicker initialItems={initialTickerItems} industryLabel={industryLabel} />

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">Today&apos;s briefing</p>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh the briefing"
            className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {dailyBriefing ? (
          <>
            <p className="mt-2 font-serif text-[15px] leading-relaxed text-slate-800">{dailyBriefing}</p>
            {briefingUpdatedAt && (
              <p className="mt-2 text-[11px] text-slate-400">
                Updated {new Date(briefingUpdatedAt).toLocaleDateString()}
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 font-serif text-[15px] leading-relaxed text-slate-500">
            A roundup of today&apos;s business news, shared across your team.
          </p>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    </aside>
  );
}
