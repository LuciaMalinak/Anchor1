import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { morningBriefs, users } from "@/db/schema";
import { getBriefRow } from "@/lib/morningBrief";
import { normalizePrefs } from "@/lib/morningBriefPrefs";
import { getGoogleConnection } from "@/lib/integrations/google";
import { GOOGLE_EXTRA_SCOPES, isProviderConfigured } from "@/lib/integrations/config";
import { getSlackConnection } from "@/lib/integrations/slack";
import { isSmsConfigured } from "@/lib/sms";

// The Profile page's Morning brief settings: what's saved, plus what each
// channel and option needs (a phone, Gmail, Slack) so the page can say so.
async function status(userId: string) {
  const [[user], row, google, slack] = await Promise.all([
    db.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, userId)),
    getBriefRow(userId),
    getGoogleConnection(userId),
    getSlackConnection(userId),
  ]);
  return {
    enabled: row?.enabled ?? false,
    prefs: normalizePrefs(row?.prefs),
    lastSentOn: row?.lastSentOn ?? null,
    setup: {
      email: user?.email ?? null,
      phone: user?.phone ?? null,
      smsReady: isSmsConfigured(),
      googleConfigured: isProviderConfigured("google"),
      googleConnected: Boolean(google),
      gmailCanDraft: Boolean(google && (google.scope ?? "").split(/\s+/).includes(GOOGLE_EXTRA_SCOPES.gmail_compose)),
      slackConnected: Boolean(slack),
    },
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(await status(session.user.id));
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const prefs = normalizePrefs(body.prefs);
  // Only the On/Off switch sends `enabled`. Saving settings any other way
  // ("Send me one now" saves first) keeps it as it is: it used to save
  // whatever the switch showed, so trying a brief while it was off turned
  // it off for good, and auto-enable then left it off as a choice.
  const enabled = typeof body.enabled === "boolean" ? body.enabled : ((await getBriefRow(session.user.id))?.enabled ?? false);
  await db
    .insert(morningBriefs)
    .values({ userId: session.user.id, enabled, prefs, updatedAt: new Date() })
    .onConflictDoUpdate({ target: morningBriefs.userId, set: { enabled, prefs, updatedAt: new Date() } });
  return NextResponse.json(await status(session.user.id));
}
