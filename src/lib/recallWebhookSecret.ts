// Shared secret used to authorize Recall.ai's webhook calls back to us
// (both the post-call recording webhook and the real-time transcript
// webhook) — see the note in src/app/api/webhooks/recall/route.ts about
// why this is a shared-secret query param rather than verified webhook
// signatures.
//
// Deliberately NO hardcoded fallback here. This used to fall back to a
// literal string checked into the repo, which meant that if
// RECALL_WEBHOOK_SECRET was ever unset in an environment, every webhook
// call was authorized by a secret anyone who'd seen this file already
// knew — silently, with no error. Failing closed (every webhook call
// gets rejected until the real env var is set) is the safe default;
// missing an env var should break loudly, not open a hole.
export const RECALL_WEBHOOK_SECRET = process.env.RECALL_WEBHOOK_SECRET || null;
