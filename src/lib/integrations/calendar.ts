// Read-only Google Calendar lookup for a deal — matches events by
// attendee email address against the deal's known contacts, the same
// approach gmail.ts uses, since Calendar's own search doesn't reliably
// filter by attendee.
import { getGoogleConnection, googleGet } from "./google";

const MAX_EVENTS = 8;
const LOOKAHEAD_DAYS = 30;
const LOOKBACK_DAYS = 30;

export type CalendarContextItem = { summary: string; start: string; attendees: string[] };

type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email?: string }[];
  location?: string;
  description?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
};

// Zoom/Teams/Meet links people paste into an invite's location or
// description rather than using a real "conferencing" integration —
// Google's own conferenceData/hangoutLink fields (checked first, below)
// only cover Meet and anything set up through Calendar's "Add
// conferencing" picker, so this regex fallback is what catches an invite
// someone just pasted a Zoom link into.
const MEETING_LINK_RE =
  /https?:\/\/(?:[\w-]+\.)?(?:zoom\.us\/j\/[\w?&=-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>]+|meet\.google\.com\/[a-z-]+)/i;

function extractJoinUrl(e: GoogleCalendarEvent): string | null {
  if (e.hangoutLink) return e.hangoutLink;
  const videoEntry = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video");
  if (videoEntry?.uri) return videoEntry.uri;
  const haystack = `${e.location || ""}\n${e.description || ""}`;
  const match = haystack.match(MEETING_LINK_RE);
  return match ? match[0] : null;
}

export async function fetchRelevantEvents(
  userId: string,
  participantEmails: string[]
): Promise<CalendarContextItem[]> {
  const connection = await getGoogleConnection(userId);
  if (!connection) return [];

  const addresses = new Set(participantEmails.filter(Boolean).map((e) => e.toLowerCase()));
  if (addresses.size === 0) return [];

  const timeMin = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const timeMax = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString();
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
    `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
    `&singleEvents=true&orderBy=startTime&maxResults=50`;

  const { json } = await googleGet(connection, connection.accessToken, url);
  const events = Array.isArray(json.items) ? (json.items as GoogleCalendarEvent[]) : [];

  const matched = events.filter((e) => {
    const attendeeEmails = (e.attendees ?? []).map((a) => (a.email || "").toLowerCase());
    return attendeeEmails.some((email) => addresses.has(email));
  });

  return matched.slice(0, MAX_EVENTS).map((e) => ({
    summary: e.summary || "(no title)",
    start: e.start?.dateTime || e.start?.date || "",
    attendees: (e.attendees ?? []).map((a) => a.email).filter((email): email is string => Boolean(email)),
  }));
}

// How far around "now" to fetch, in hours — generous on both sides of
// the calendar day so a call just after midnight or just before it isn't
// missed by a naive UTC "today" window on the server. The caller (the
// /api/meetings/today route) still fetches this same window regardless
// of the viewer's timezone; narrowing it down to "actually today" happens
// client-side, using the browser's own local clock, since nothing here
// stores a user's timezone. See TodayMeetings.tsx.
const TODAY_LOOKBACK_HOURS = 12;
const TODAY_LOOKAHEAD_HOURS = 36;

export type TodayDealMeeting = {
  eventId: string;
  summary: string;
  start: string;
  joinUrl: string | null;
  dealId: string;
  dealName: string;
};

// Same attendee-matching idea as fetchRelevantEvents, but across every
// deal a person has at once (rather than one deal's contacts at a time)
// and narrowed to roughly "today" — this is what powers the "Today"
// to-do list on the Home page (see TodayMeetings.tsx): a calendar invite
// for a deal Anchor already knows shows up there automatically, with a
// join link pre-filled if one could be found on the invite.
export async function fetchTodaysDealMeetings(
  userId: string,
  dealParticipants: { dealId: string; dealName: string; emails: string[] }[]
): Promise<TodayDealMeeting[]> {
  const connection = await getGoogleConnection(userId);
  if (!connection) return [];

  const dealsWithEmails = dealParticipants
    .map((d) => ({ ...d, emails: d.emails.map((e) => e.toLowerCase()).filter(Boolean) }))
    .filter((d) => d.emails.length > 0);
  if (dealsWithEmails.length === 0) return [];

  const timeMin = new Date(Date.now() - TODAY_LOOKBACK_HOURS * 3_600_000).toISOString();
  const timeMax = new Date(Date.now() + TODAY_LOOKAHEAD_HOURS * 3_600_000).toISOString();
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
    `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
    `&singleEvents=true&orderBy=startTime&maxResults=50`;

  const { json } = await googleGet(connection, connection.accessToken, url);
  const events = Array.isArray(json.items) ? (json.items as GoogleCalendarEvent[]) : [];

  const results: TodayDealMeeting[] = [];
  for (const e of events) {
    if (!e.id || !e.start?.dateTime) continue; // skip all-day events — nothing to "join"
    const attendeeEmails = (e.attendees ?? []).map((a) => (a.email || "").toLowerCase());
    const matchedDeal = dealsWithEmails.find((d) => d.emails.some((em) => attendeeEmails.includes(em)));
    if (!matchedDeal) continue;
    results.push({
      eventId: e.id,
      summary: e.summary || matchedDeal.dealName,
      start: e.start.dateTime,
      joinUrl: extractJoinUrl(e),
      dealId: matchedDeal.dealId,
      dealName: matchedDeal.dealName,
    });
  }
  return results;
}
