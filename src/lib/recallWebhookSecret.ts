// Shared secret used to authorize Recall.ai's webhook calls back to us
// (both the post-call recording webhook and the real-time transcript
// webhook) — see the note in src/app/api/webhooks/recall/route.ts about
// why this is a shared-secret query param rather than verified webhook
// signatures.
export const RECALL_WEBHOOK_SECRET =
  process.env.RECALL_WEBHOOK_SECRET || "a7eddd2aa32dc530be105a56b90cdcd7";
