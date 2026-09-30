// Creates an event on the user's primary Google Calendar, from a
// suggestion on the meeting page (see suggestInvites.ts). Only runs when
// they click "Add to calendar"; attendees are emailed only if they leave
// "Email the invite" ticked. Needs the calendar.events permission.
import { googlePost, requireGoogleScope } from "./google";

export type EventInput = {
  title: string;
  description?: string;
  startISO: string; // local wall time, e.g. 2026-10-02T10:00:00
  endISO: string;
  timeZone: string; // IANA, e.g. America/New_York
  attendees: string[];
  addMeetLink: boolean;
  sendInvites: boolean; // false = only on the user's calendar; true = Google emails the attendees
};

export async function createCalendarEvent(userId: string, e: EventInput) {
  const connection = await requireGoogleScope(userId, "calendar_events");
  const params = new URLSearchParams({ sendUpdates: e.sendInvites ? "all" : "none" });
  if (e.addMeetLink) params.set("conferenceDataVersion", "1");
  const event = await googlePost(
    connection,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    {
      summary: e.title,
      description: e.description,
      start: { dateTime: e.startISO, timeZone: e.timeZone },
      end: { dateTime: e.endISO, timeZone: e.timeZone },
      attendees: e.attendees.map((email) => ({ email })),
      ...(e.addMeetLink
        ? {
            conferenceData: {
              createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
            },
          }
        : {}),
      reminders: { useDefault: true },
    }
  );
  return { openUrl: typeof event.htmlLink === "string" ? event.htmlLink : null };
}
