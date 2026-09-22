import { NextResponse } from "next/server";

// Recall.ai's API is region-scoped (see src/lib/recall.ts's REGION/BASE_URL
// and its comment) — an upload token created by our backend against
// https://${REGION}.recall.ai is only valid against that SAME region. The
// desktop app's native RecallAiSdk.init() has no way to know that region
// on its own and otherwise defaults to Recall's generic api.recall.ai
// host, which is NOT guaranteed to be the same region as our account —
// this mismatch is exactly what was causing "Invalid upload token" to
// fail a desktop recording even right after a fresh, valid token was
// issued. desktop/src/main.ts fetches this once at startup, before
// calling RecallAiSdk.init(), and passes the result as `apiUrl`.
//
// Public and unauthenticated on purpose: this only discloses which Recall
// region this deployment uses (an operational detail, not a secret — the
// desktop app's own network traffic reveals as much anyway), and it has
// to be callable before the desktop app has any token to authenticate
// with, since it runs before a member has necessarily connected the app
// to their account yet.
export async function GET() {
  const region = process.env.RECALL_REGION || "us-east-1";
  return NextResponse.json({ apiUrl: `https://${region}.recall.ai/api/v1` });
}
