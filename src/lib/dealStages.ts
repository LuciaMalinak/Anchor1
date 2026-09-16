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
