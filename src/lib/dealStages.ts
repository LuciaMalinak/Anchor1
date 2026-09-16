// Shared between the deal PATCH route (server-side validation) and the
// deal profile edit form (client-side dropdown), so the two never drift.
export const DEAL_STAGES = [
  "Prospecting",
  "Qualifying",
  "Proposal",
  "Negotiation",
  "Closed won",
  "Closed lost",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

// Used on the deal cards in the Deals list so a stage is recognizable by
// color at a glance, not just by its label.
export const STAGE_BADGE_CLASSES: Record<string, string> = {
  Prospecting: "bg-slate-100 text-slate-600",
  Qualifying: "bg-sky-100 text-sky-700",
  Proposal: "bg-amber-100 text-amber-700",
  Negotiation: "bg-accent/10 text-accent",
  "Closed won": "bg-emerald-100 text-emerald-700",
  "Closed lost": "bg-rose-100 text-rose-700",
};

export const DEFAULT_STAGE_BADGE_CLASSES = "bg-slate-100 text-slate-600";
