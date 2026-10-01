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

// Team-wide news (the industry ticker and today's briefing) now lives on
// the Home page only; the right-hand column on every page belongs to Ask
// Anchor (see AskAnchorDock.tsx). Deal pages show their own company news.
function isHomePath(pathname: string | null): boolean {
  return pathname === "/dashboard";
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

  if (!isHomePath(pathname)) return null;

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
    <section aria-label="News" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <IndustryTicker initialItems={initialTickerItems} industryLabel={industryLabel} />

      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-brand">Today&apos;s briefing</h2>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="shrink-0 text-xs font-medium text-brand hover:underline disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {dailyBriefing ? (
          <>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{dailyBriefing}</p>
            {briefingUpdatedAt && (
              <p className="mt-1 text-[11px] text-slate-400">
                {new Date(briefingUpdatedAt).toLocaleDateString()}
              </p>
            )}
          </>
        ) : (
          <p className="mt-1.5 text-sm text-slate-400">
            A roundup of today&apos;s business news for your industry, shared across your team.
          </p>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </section>
  );
}
