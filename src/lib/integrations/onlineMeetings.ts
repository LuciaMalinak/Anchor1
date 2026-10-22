// Creating meetings outside Google: Outlook calendar events (with or
// without a Teams link) through Microsoft Graph, and Zoom meetings. Used
// by meetingScheduler.ts.
import { apiFetch, getConnection } from "./oauthConnection";

// The connection is missing, or was made before Anchor asked for the
// permission this needs. The route turns it into a "Connect" link.
export class NeedsConnectionError extends Error {
  constructor(public provider: "microsoft" | "zoom", message: string) {
    super(message);
  }
}

// Outlook event in the person's own calendar. Outlook emails the
// invitation to every attendee, and it lands in their calendars. With
// teams: true it carries a Teams meeting link.
export async function createOutlookEvent(
  userId: string,
  e: {
    title: string;
    description: string;
    startISO: string; // local wall time
    endISO: string;
    timeZone: string; // IANA; Graph accepts IANA names
    attendees: string[];
    location?: string;
    teams: boolean;
  }
): Promise<{ openUrl: string | null; joinUrl: string | null }> {
  const connection = await getConnection(userId, "microsoft");
  if (!connection) throw new NeedsConnectionError("microsoft", "Connect Microsoft 365 to create Teams and Outlook meetings.");
  if (!/Calendars\.ReadWrite/i.test(connection.scope ?? "")) {
    throw new NeedsConnectionError("microsoft", "Reconnect Microsoft 365 so Anchor can add meetings to your Outlook calendar.");
  }
  const res = await apiFetch(connection, "https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    body: JSON.stringify({
      subject: e.title,
      body: { contentType: "text", content: e.description },
      start: { dateTime: e.startISO, timeZone: e.timeZone },
      end: { dateTime: e.endISO, timeZone: e.timeZone },
      attendees: e.attendees.map((address) => ({ emailAddress: { address }, type: "required" })),
      ...(e.location ? { location: { displayName: e.location } } : {}),
      ...(e.teams ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
    }),
  });
  if (res.status === 403) {
    throw new NeedsConnectionError("microsoft", "Reconnect Microsoft 365 so Anchor can add meetings to your Outlook calendar.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Outlook didn't create the meeting (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  return {
    openUrl: typeof body.webLink === "string" ? body.webLink : null,
    joinUrl: typeof body.onlineMeeting?.joinUrl === "string" ? body.onlineMeeting.joinUrl : null,
  };
}

// A scheduled Zoom meeting on the person's Zoom account. Zoom doesn't
// invite anyone itself; meetingScheduler puts the link in the calendar
// invitation.
export async function createZoomMeeting(
  userId: string,
  m: { title: string; agenda: string; startISO: string; timeZone: string; durationMinutes: number }
): Promise<{ joinUrl: string; meetingId: string | null }> {
  const connection = await getConnection(userId, "zoom");
  if (!connection) throw new NeedsConnectionError("zoom", "Connect Zoom to create Zoom meetings.");
  const res = await apiFetch(connection, "https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    body: JSON.stringify({
      topic: m.title.slice(0, 200),
      type: 2, // scheduled
      start_time: m.startISO.length === 16 ? `${m.startISO}:00` : m.startISO,
      timezone: m.timeZone,
      duration: m.durationMinutes,
      agenda: m.agenda.slice(0, 2000),
      settings: { join_before_host: true, waiting_room: false },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.join_url !== "string") {
    throw new Error(`Zoom didn't create the meeting (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return { joinUrl: body.join_url, meetingId: body.id != null ? String(body.id) : null };
}
