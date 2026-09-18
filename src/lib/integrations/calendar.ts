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
  summary?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email?: string }[];
};

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
