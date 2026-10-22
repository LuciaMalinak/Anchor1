import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { morningBriefs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getBriefRow } from "@/lib/morningBrief";
import { DEFAULT_PREFS, briefSettingsSaved, isValidTimeZone, normalizePrefs, shouldAutoEnableBrief } from "@/lib/morningBriefPrefs";
import { getGoogleConnection } from "@/lib/integrations/google";
import { GOOGLE_EXTRA_SCOPES } from "@/lib/integrations/config";

// Turns the Morning brief on for anyone who hasn't switched it off
// themselves (see shouldAutoEnableBrief), sent from Home with their own
// time zone, so every member gets it without finding the setting. Gmail
// isn't required: without it the brief still has their to-dos, today's
// meetings and quiet deals (an empty brief isn't sent).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const userId = session.user.id;
  const body = await req.json().catch(() => ({}));
  const [row, google] = await Promise.all([getBriefRow(userId), getGoogleConnection(userId)]);
  const gmailCanDraft = Boolean(google && (google.scope ?? "").split(/\s+/).includes(GOOGLE_EXTRA_SCOPES.gmail_compose));
  // Switched on by the server with a guessed time zone: now that they're
  // here, use their browser's, keeping their 8am an 8am where they are.
  if (row?.enabled && row.timeZoneGuessed) {
    const prefs = { ...normalizePrefs(row.prefs), ...(isValidTimeZone(body.timeZone) ? { timeZone: body.timeZone } : {}) };
    await db.update(morningBriefs).set({ prefs, timeZoneGuessed: false, updatedAt: new Date() }).where(eq(morningBriefs.userId, userId));
    return NextResponse.json({ enabled: true, turnedOn: true, prefs, googleConnected: Boolean(google), gmailCanDraft });
  }
  if (!shouldAutoEnableBrief(row)) {
    return NextResponse.json({ enabled: row?.enabled ?? false, turnedOn: false, prefs: normalizePrefs(row?.prefs), googleConnected: Boolean(google), gmailCanDraft });
  }
  // Keeps a time someone already picked; otherwise 8am in their time zone.
  const prefs =
    row && briefSettingsSaved(row.prefs)
      ? normalizePrefs(row.prefs)
      : { ...DEFAULT_PREFS, timeZone: isValidTimeZone(body.timeZone) ? body.timeZone : DEFAULT_PREFS.timeZone };
  await db
    .insert(morningBriefs)
    .values({ userId, enabled: true, prefs, updatedAt: new Date() })
    .onConflictDoUpdate({ target: morningBriefs.userId, set: { enabled: true, prefs, updatedAt: new Date() } });
  return NextResponse.json({ enabled: true, turnedOn: true, prefs, googleConnected: Boolean(google), gmailCanDraft });
}
