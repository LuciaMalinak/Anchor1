// Background refreshes of shared AI content (the industry ticker, the
// daily briefing), kicked off from page loads and polls. Without this,
// every page view while the cache was stale started another web-search
// call (each takes ~20s, so a few clicks meant a few paid duplicates), a
// failure was retried on the very next page view, and two teams in the
// same industry each paid for the same news. Now:
// - one refresh per team at a time;
// - after a failure, none for FAILURE_BACKOFF_MS;
// - a result made for one team is reused by other teams with the same
//   shareKey (their industry) while it's younger than shareForMs.
// In memory is enough: a restart just means the next page view refreshes.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { BRIEFING_STALE_AFTER_MS, getDailyBriefing } from "./dailyBriefing";
import { getIndustryTicker, TICKER_STALE_AFTER_MS } from "./industryTicker";
import type { IndustryKey } from "./industries";

const FAILURE_BACKOFF_MS = 15 * 60_000;

// On globalThis, not module scope: Next bundles pages and route handlers
// separately, so each would otherwise keep its own copy and both could
// refresh the same team at once.
type State = {
  running: Set<string>;
  failedAt: Map<string, number>;
  shared: Map<string, { at: number; value: Promise<unknown> }>;
};
const g = globalThis as typeof globalThis & { __anchorBackgroundRefresh?: State };
const state = (g.__anchorBackgroundRefresh ??= { running: new Set(), failedAt: new Map(), shared: new Map() });
const { running, failedAt, shared } = state;

export function refreshInBackground<T>(opts: {
  key: string;
  shareKey: string;
  shareForMs: number;
  build: () => Promise<T>;
  // builtAt is when the shared result was made, so a team handed an
  // older one goes stale on time rather than a full period later.
  save: (value: T, builtAt: Date) => Promise<unknown>;
  label: string;
}): void {
  const { key, shareKey, shareForMs, build, save, label } = opts;
  if (running.has(key)) return;
  if (Date.now() - (failedAt.get(key) ?? 0) < FAILURE_BACKOFF_MS) return;

  let entry = shared.get(shareKey);
  if (!entry || Date.now() - entry.at > shareForMs) {
    entry = { at: Date.now(), value: build() };
    shared.set(shareKey, entry);
    // A failed build mustn't be handed to the next team.
    entry.value.catch(() => {
      if (shared.get(shareKey) === entry) shared.delete(shareKey);
    });
  }

  running.add(key);
  (entry.value as Promise<T>)
    .then((value) => save(value, new Date(entry.at)))
    .then(() => failedAt.delete(key))
    .catch((err) => {
      failedAt.set(key, Date.now());
      console.error(`Background ${label} refresh failed:`, err);
    })
    .finally(() => running.delete(key));
}

export function refreshTeamTicker(teamId: string, industry: IndustryKey | null) {
  refreshInBackground({
    key: `ticker:${teamId}`,
    shareKey: `ticker:${industry ?? "general"}`,
    shareForMs: TICKER_STALE_AFTER_MS,
    build: () => getIndustryTicker(industry),
    save: (items, builtAt) => db.update(teams).set({ industryTicker: items, industryTickerUpdatedAt: builtAt }).where(eq(teams.id, teamId)),
    label: "industry ticker",
  });
}

export function refreshTeamBriefing(teamId: string, industry: IndustryKey | null) {
  refreshInBackground({
    key: `briefing:${teamId}`,
    shareKey: `briefing:${industry ?? "general"}`,
    shareForMs: BRIEFING_STALE_AFTER_MS,
    build: () => getDailyBriefing(industry),
    save: (briefing, builtAt) => db.update(teams).set({ dailyBriefing: briefing, dailyBriefingUpdatedAt: builtAt }).where(eq(teams.id, teamId)),
    label: "daily briefing",
  });
}
