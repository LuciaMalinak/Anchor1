"use client";

import { useEffect, useState } from "react";
import type { TickerItem } from "@/lib/industryTicker";

// The small "always running" bar above Today's Briefing — short,
// concrete headlines (market/stock moves for a finance team, the
// equivalent for any other industry — see src/lib/industryTicker.ts)
// scrolling continuously via pure CSS, with the actual content behind it
// refreshed server-side every 20 minutes and picked up here by polling.
// Polling, not a live socket: there's no market-data feed wired in, so
// "live" means "refreshes on its own every few minutes," not tick-by-tick
// prices — see globals.css's .ticker-track for the scroll animation.
//
// Once populated, every 5 minutes is plenty (the underlying cache only
// changes every 20 minutes anyway — see isTickerStale).
const POLL_INTERVAL_MS = 5 * 60 * 1000;

// While there's nothing to show yet — most notably right after a team
// switches industry (this component remounts empty; see the `key` on
// GeneralNewsSidebar in layout.tsx) — poll much faster so the new
// sector's ticker appears within seconds instead of sitting blank for up
// to 5 minutes. Same idea as GeneralNewsSidebar's briefing poll.
const EMPTY_POLL_INTERVAL_MS = 10 * 1000;

// A small colored arrow/dot next to each line — green up, red down, a
// neutral dot for headlines with no directional number (an approval, an
// M&A deal) — the "read it like a real stock ticker at a glance" part.
function DirectionMark({ direction }: { direction: TickerItem["direction"] }) {
  if (direction === "up") {
    return <span className="mr-1 text-emerald-400">▲</span>;
  }
  if (direction === "down") {
    return <span className="mr-1 text-rose-400">▼</span>;
  }
  return <span className="mr-1 text-slate-500">●</span>;
}

export function IndustryTicker({
  initialItems,
  industryLabel,
}: {
  initialItems: TickerItem[];
  industryLabel: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const isEmpty = items.length === 0;

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

    // Check right away rather than waiting for the first interval tick —
    // matters most right after an industry switch, when the background
    // refresh for the new sector (kicked off by this same GET route) is
    // already in flight and often lands within seconds.
    poll();
    const interval = setInterval(poll, isEmpty ? EMPTY_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Re-running this effect when isEmpty flips from true to false is the
    // point: it swings from fast polling (nothing to show yet) to the
    // slower steady-state cadence the moment real items land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmpty]);

  if (isEmpty) {
    // A brief, expected gap — right after signup or an industry switch,
    // before the first background fetch for this sector lands (seconds,
    // not minutes, thanks to the fast polling above). Showing this
    // instead of nothing keeps the layout stable and makes clear the
    // ticker is actively catching up to the new sector, not broken.
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
        <div className="px-3 py-2 text-xs font-medium text-slate-400">
          Pulling today&apos;s {industryLabel ? industryLabel.toLowerCase() : "market"} headlines…
        </div>
      </div>
    );
  }

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
          <span
            key={i}
            className="mx-4 flex shrink-0 items-center font-mono text-xs font-medium text-slate-100"
          >
            <DirectionMark direction={item.direction} />
            {item.text}
          </span>
        ))}
      </div>
    </div>
  );
}
