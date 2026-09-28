import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, teams } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { buildDailyDigestText } from "@/lib/dailyDigest";
import { sendSms, isSmsConfigured } from "@/lib/sms";

// Not user-triggered — this is the actual "send the 9am text" job, meant
// to be hit once a day by something outside this app (Render's own Cron
// Job service, or a free external scheduler like cron-job.org) since
// this app has no built-in scheduler of its own. Two things have to be
// true before it does anything real:
//
//   1. CRON_SECRET is set here and matched by whatever calls this URL
//      (?key=...) — this endpoint sends real text messages, so it can't
//      be left open to the internet.
//   2. TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER are set (see
//      src/lib/sms.ts) — until then every call here safely no-ops per
//      user (logs what WOULD have been sent) instead of throwing, so
//      this can be wired up and tested end-to-end before Twilio exists.
//
// Scoped to users who both have a phone number on file AND explicitly
// opted in (users.dailyDigestOptIn) — see /api/profile.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const optedIn = await db
    .select({ id: users.id, phone: users.phone, teamId: users.teamId })
    .from(users)
    .where(and(eq(users.dailyDigestOptIn, true), isNotNull(users.phone), isNotNull(users.teamId)));

  const digestByTeam = new Map<string, string | null>();
  let usersTexted = 0;
  let usersSkippedNothingNew = 0;
  let usersSkippedNotConfigured = 0;

  for (const u of optedIn) {
    const teamId = u.teamId!;
    if (!digestByTeam.has(teamId)) {
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
      const text = team ? await buildDailyDigestText({ teamId, teamName: team.name }) : null;
      digestByTeam.set(teamId, text);
    }
    const text = digestByTeam.get(teamId);
    if (!text) {
      usersSkippedNothingNew++;
      continue;
    }
    const result = await sendSms(u.phone!, text);
    if (result.sent) {
      usersTexted++;
    } else if (result.reason === "not_configured") {
      usersSkippedNotConfigured++;
    }
  }

  return NextResponse.json({
    ok: true,
    smsConfigured: isSmsConfigured(),
    eligibleUsers: optedIn.length,
    usersTexted,
    usersSkippedNothingNew,
    usersSkippedNotConfigured,
  });
}
