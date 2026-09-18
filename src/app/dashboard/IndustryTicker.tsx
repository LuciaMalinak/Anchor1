"use client";

import { useEffect, useState } from "react";

// The small "always running" bar above Today's Briefing — short,
// concrete headlines (market/stock moves for a finance team, the
// equivalent for any other industry — see src/lib/industryTicker.ts)
// scrolling continuously via pure CSS, with the actual content behind it
// refreshed server-side every 20 minutes and picked up here by polling.
// Polling, not a live socket: there's no market-data feed wired in, so
// "live" means "refreshes on its own every few minutes," not tick-by-tick
// prices — see globals.css's .ticker-track for the scroll animation.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function IndustryTicker({
  initialItems,
  industryLabel,
}: {
  initialItems: string[];
  industryLabel: string | null;
}) {
  const [items, setItems] = useState(initialItems);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/team/ticker");
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        if (!cancelled && Array.isArray(body?.items) && body.items.length > 0) {
          setItems(body.items);
        }
      } catch {
        // Ambient background polling — a failed poll just means the
        // ticker keeps showing whatever it already has. Never worth
        // surfacing an error for this.
      }
    }

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (items.length === 0) return null;

  // Duplicated once so the CSS animation can scroll from 0 to exactly
  // -50% and loop with no visible seam or snap-back.
  const loopItems = [...items, ...items];

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-[10px] font-semibold tracking-[0.15em] text-slate-300">
          {industryLabel ? `${industryLabel.toUpperCase()} · LIVE` : "MARKETS · LIVE"}
        </span>
      </div>
      <div className="ticker-track flex whitespace-nowrap py-2">
        {loopItems.map((item, i) => (
          <span key={i} className="mx-4 shrink-0 text-xs font-medium text-slate-100">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
