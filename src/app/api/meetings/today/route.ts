import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, meetings, meetingParticipants, contacts, integrationConnections } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { fetchTodaysDealMeetings } from "@/lib/integrations/calendar";

// Backs the "Today" list on the Home page (see TodayMeetings.tsx): a
// calendar invite that matches a deal Anchor already knows about (by
// attendee email — same signal calendarContext already uses) shows up
// here, with a join link pre-filled where one could be found on the
// invite. Google Calendar only for now — Outlook/Teams calendar reading
// isn't wired up yet even though the connection itself exists (see
// src/lib/integrations/config.ts's "microsoft" provider).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ meetings: [], googleConnected: false });
  }

  const [connection] = await db
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.userId, session.user.id), eq(integrationConnections.provider, "google")))
    .limit(1);

  if (!connection) {
    return NextResponse.json({ meetings: [], googleConnected: false });
  }

  const teamId = await getOrCreateTeamId(session.user.id);
  const teamDeals = await db
    .select({ id: deals.id, name: deals.name, primaryContactEmail: deals.primaryContactEmail })
    .from(deals)
    .where(eq(deals.teamId, teamId));

  if (teamDeals.length === 0) {
    return NextResponse.json({ meetings: [], googleConnected: true });
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
    const todayMeetings = await fetchTodaysDealMeetings(session.user.id, dealParticipants);
    return NextResponse.json({ meetings: todayMeetings, googleConnected: true });
  } catch (err) {
    console.error("[meetings/today] Failed to fetch calendar meetings:", err);
    // Best-effort, same as calendarContext elsewhere — a revoked token or
    // an API hiccup just means an empty list, not a broken Home page.
    return NextResponse.json({ meetings: [], googleConnected: true });
  }
}
