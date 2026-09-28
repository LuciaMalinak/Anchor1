import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { deals, meetings, meetingParticipants, contacts, integrationConnections } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { fetchTodaysDealMeetings } from "@/lib/integrations/calendar";
import { authenticateBearer } from "@/lib/apiToken";

// The desktop app's answer to "which deal is this Zoom call for?" — same
// attendee-email-against-calendar matching /api/meetings/today already
// uses for the Home page's "Today" list, just narrowed down to a single
// best guess for whatever's happening right now instead of a whole day's
// list. Called from desktop/src/main.ts's beginRecording() right before
// creating the meeting, so a desktop recording lands on the right deal
// automatically instead of always coming through unassigned — see
// desktop/src/anchorApi.ts's matchDealNow().
//
// Best-effort by design: no Google Calendar connection, no matching
// event, or an API hiccup all just mean "no match" (dealId: null) rather
// than an error — the recording still starts either way, just unassigned,
// exactly like before this existed.
const LOOK_AHEAD_MINUTES = 15; // a call started slightly before its invite's start time still counts as "now"
const LOOK_BACK_HOURS = 4; // meetings don't usually run longer than this

export async function GET(req: NextRequest) {
  const userId = await authenticateBearer(req);
  if (!userId) {
    return NextResponse.json({ error: "Invalid or missing desktop token" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(userId);
  const teamDeals = await db
    .select({ id: deals.id, name: deals.name, primaryContactEmail: deals.primaryContactEmail })
    .from(deals)
    .where(eq(deals.teamId, teamId));

  if (teamDeals.length === 0) {
    return NextResponse.json({ dealId: null });
  }

  const [connection] = await db
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, "google")))
    .limit(1);
  if (!connection) {
    return NextResponse.json({ dealId: null });
  }

  const dealIds = teamDeals.map((d) => d.id);
  const participantRows = await db
    .selectDistinct({ dealId: meetings.dealId, email: contacts.email })
    .from(meetingParticipants)
    .innerJoin(meetings, eq(meetingParticipants.meetingId, meetings.id))
    .innerJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
    .where(inArray(meetings.dealId, dealIds));

  const emailsByDeal = new Map<string, Set<string>>();
  for (const d of teamDeals) {
    const set = new Set<string>();
    if (d.primaryContactEmail) set.add(d.primaryContactEmail.toLowerCase());
    emailsByDeal.set(d.id, set);
  }
  for (const r of participantRows) {
    if (!r.dealId || !r.email) continue;
    emailsByDeal.get(r.dealId)?.add(r.email.toLowerCase());
  }

  const dealParticipants = teamDeals
    .map((d) => ({ dealId: d.id, dealName: d.name, emails: Array.from(emailsByDeal.get(d.id) ?? []) }))
    .filter((d) => d.emails.length > 0);

  try {
    const todayMeetings = await fetchTodaysDealMeetings(userId, dealParticipants);
    const now = Date.now();
    const earliestStart = now - LOOK_BACK_HOURS * 3_600_000;
    const latestStart = now + LOOK_AHEAD_MINUTES * 60_000;

    let best: (typeof todayMeetings)[number] | null = null;
    let bestDistance = Infinity;
    for (const m of todayMeetings) {
      const startMs = new Date(m.start).getTime();
      if (Number.isNaN(startMs) || startMs < earliestStart || startMs > latestStart) continue;
      const distance = Math.abs(now - startMs);
      if (distance < bestDistance) {
        best = m;
        bestDistance = distance;
      }
    }

    return NextResponse.json({ dealId: best?.dealId ?? null, dealName: best?.dealName ?? null });
  } catch (err) {
    console.error("[desktop/deals/match-now] Failed to match a deal from calendar:", err);
    return NextResponse.json({ dealId: null });
  }
}
