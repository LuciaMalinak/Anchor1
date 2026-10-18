import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { morningBriefs } from "@/db/schema";
import { getBriefRow } from "@/lib/morningBrief";
import { DEFAULT_PREFS, briefSettingsSaved, isValidTimeZone, normalizePrefs } from "@/lib/morningBriefPrefs";
import { getGoogleConnection } from "@/lib/integrations/google";
import { GOOGLE_EXTRA_SCOPES } from "@/lib/integrations/config";

// Turns the Morning brief on for someone who has Gmail connected and has
// never set it up, in their own time zone (sent from Home), so it works
// without anyone having to find the setting. Anyone who has saved a
// choice, including turning it off, is left exactly as they are.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const userId = session.user.id;
  const body = await req.json().catch(() => ({}));
  const [row, google] = await Promise.all([getBriefRow(userId), getGoogleConnection(userId)]);
  const gmailCanDraft = Boolean(google && (google.scope ?? "").split(/\s+/).includes(GOOGLE_EXTRA_SCOPES.gmail_compose));
  // A row can exist without anyone choosing anything (Done / Snooze on an
  // email, or drafting, store state in it); only saved settings count.
  if (row && (row.enabled || briefSettingsSaved(row.prefs))) {
    return NextResponse.json({ enabled: row.enabled, turnedOn: false, prefs: normalizePrefs(row.prefs), googleConnected: Boolean(google), gmailCanDraft });
  }
  if (!google) return NextResponse.json({ enabled: false, turnedOn: false, googleConnected: false, gmailCanDraft });
  const prefs = { ...DEFAULT_PREFS, timeZone: isValidTimeZone(body.timeZone) ? body.timeZone : DEFAULT_PREFS.timeZone };
  await db
    .insert(morningBriefs)
    .values({ userId, enabled: true, prefs, updatedAt: new Date() })
    .onConflictDoUpdate({ target: morningBriefs.userId, set: { enabled: true, prefs, updatedAt: new Date() } });
  return NextResponse.json({ enabled: true, turnedOn: true, prefs, googleConnected: true, gmailCanDraft });
}
