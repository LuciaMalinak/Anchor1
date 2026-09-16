// A lightweight, computed-not-stored signal for how "warm" a deal is —
// no schema change needed, since it's derived from data we already have
// (stage + the most recent activity timestamp). Used on the Deals list,
// the deal detail page, and the dashboard's "Needs attention" panel so
// the three stay in sync automatically.

export type DealHealth = "on-track" | "needs-attention" | "stalled" | "closed";

const CLOSED_STAGES = new Set(["Closed won", "Closed lost"]);

// Thresholds are deliberately generous — this is meant to catch deals
// that have gone quiet, not to nag about anything less than a couple of
// weeks old.
const NEEDS_ATTENTION_DAYS = 10;
const STALLED_DAYS = 21;

export function computeDealHealth(params: {
  stage: string;
  lastActivityAt: Date | null;
  createdAt: Date;
}): DealHealth {
  if (CLOSED_STAGES.has(params.stage)) return "closed";

  const reference = params.lastActivityAt ?? params.createdAt;
  const daysSince = (Date.now() - reference.getTime()) / 86_400_000;

  if (daysSince > STALLED_DAYS) return "stalled";
  if (daysSince > NEEDS_ATTENTION_DAYS) return "needs-attention";
  return "on-track";
}

export function daysSinceActivity(params: { lastActivityAt: Date | null; createdAt: Date }): number {
  const reference = params.lastActivityAt ?? params.createdAt;
  return Math.floor((Date.now() - reference.getTime()) / 86_400_000);
}

export const HEALTH_LABEL: Record<DealHealth, string> = {
  "on-track": "On track",
  "needs-attention": "Needs attention",
  stalled: "Stalled",
  closed: "Closed",
};

// Small dot + text color, meant to sit next to (not replace) the stage
// badge — stage says where it is in the pipeline, health says whether it
// needs a look.
export const HEALTH_BADGE_CLASSES: Record<DealHealth, string> = {
  "on-track": "bg-emerald-50 text-emerald-700",
  "needs-attention": "bg-amber-50 text-amber-700",
  stalled: "bg-rose-50 text-rose-700",
  closed: "bg-slate-100 text-slate-500",
};

export const HEALTH_DOT_CLASSES: Record<DealHealth, string> = {
  "on-track": "bg-emerald-500",
  "needs-attention": "bg-amber-500",
  stalled: "bg-rose-500",
  closed: "bg-slate-400",
};
