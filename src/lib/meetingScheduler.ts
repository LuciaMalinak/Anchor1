import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { GOOGLE_EXTRA_SCOPES, isProviderConfigured } from "@/lib/integrations/config";
import { NeedsGooglePermissionError, getGoogleConnection } from "@/lib/integrations/google";
import { getConnection } from "@/lib/integrations/oauthConnection";
import { createCalendarEvent } from "@/lib/integrations/calendarEvent";
import { createOutlookEvent, createZoomMeeting } from "@/lib/integrations/onlineMeetings";
import { endISO } from "@/lib/suggestInvites";

// Setting up a meeting from Anchor in one go: the video link (Google Meet,
// Zoom or Teams) or a place, the event in the organizer's calendar, and
// the invitation to everyone, which their calendar (Google or Outlook)
// emails out and adds to each attendee's calendar. Used for meetings
// someone asked for by email or Slack (see /api/schedule-meeting).

export type MeetingPlatform = "google_meet" | "zoom" | "teams" | "in_person";

export const PLATFORM_LABEL: Record<MeetingPlatform, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  in_person: "In person",
};

export type PlatformOption = {
  platform: MeetingPlatform;
  label: string;
  available: boolean;
  // Where to connect what this option needs, when it isn't available.
  connectUrl: string | null;
  note: string | null;
};

type Calendars = { google: boolean; googleCanWrite: boolean; outlook: boolean };

async function calendars(userId: string): Promise<Calendars> {
  const [google, microsoft] = await Promise.all([getGoogleConnection(userId), getConnection(userId, "microsoft")]);
  return {
    google: Boolean(google),
    googleCanWrite: (google?.scope ?? "").split(/\s+/).includes(GOOGLE_EXTRA_SCOPES.calendar_events),
    outlook: Boolean(microsoft && /Calendars\.ReadWrite/i.test(microsoft.scope ?? "")),
  };
}

const connect = (provider: string, returnTo: string, add?: string) =>
  `/api/integrations/${provider}/connect?${add ? `add=${add}&` : ""}returnTo=${encodeURIComponent(returnTo)}`;

// Which ways to meet this person can use right now, and how to unlock the
// others.
export async function platformOptions(userId: string, returnTo: string): Promise<PlatformOption[]> {
  const [cal, zoom] = await Promise.all([calendars(userId), getConnection(userId, "zoom")]);
  const anyCalendar = cal.google || cal.outlook;
  const calendarConnect = connect("google", returnTo, "calendar_events");
  return [
    {
      platform: "google_meet",
      label: PLATFORM_LABEL.google_meet,
      available: cal.google,
      connectUrl: cal.google ? null : calendarConnect,
      note: cal.google ? null : "Connect Google Calendar",
    },
    {
      platform: "zoom",
      label: PLATFORM_LABEL.zoom,
      available: Boolean(zoom) && anyCalendar,
      connectUrl: !isProviderConfigured("zoom") ? null : !zoom ? connect("zoom", returnTo) : anyCalendar ? null : calendarConnect,
      note: !isProviderConfigured("zoom")
        ? "Zoom isn't set up on Anchor yet"
        : !zoom
          ? "Connect Zoom"
          : anyCalendar
            ? null
            : "Connect a calendar to send the invites",
    },
    {
      platform: "teams",
      label: PLATFORM_LABEL.teams,
      available: cal.outlook,
      connectUrl: cal.outlook || !isProviderConfigured("microsoft") ? null : connect("microsoft", returnTo),
      note: cal.outlook ? null : isProviderConfigured("microsoft") ? "Connect Microsoft 365" : "Microsoft isn't set up on Anchor yet",
    },
    {
      platform: "in_person",
      label: PLATFORM_LABEL.in_person,
      available: anyCalendar,
      connectUrl: anyCalendar ? null : calendarConnect,
      note: anyCalendar ? null : "Connect a calendar to send the invites",
    },
  ];
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export type ScheduleInput = {
  platform: MeetingPlatform;
  title: string;
  description: string;
  start: string; // local wall time "YYYY-MM-DDTHH:MM" in timeZone
  durationMinutes: number;
  timeZone: string;
  attendees: string[];
  location?: string;
};

export type ScheduleResult = {
  platform: MeetingPlatform;
  calendar: "google" | "outlook";
  openUrl: string | null;
  joinUrl: string | null;
  invited: string[];
};

export async function scheduleMeeting(userId: string, input: ScheduleInput): Promise<ScheduleResult> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const google = await getGoogleConnection(userId);
  const mine = new Set([user?.email, google?.externalAccountEmail].filter(Boolean).map((e) => e!.toLowerCase()));
  const invited = [...new Set(input.attendees.map((a) => a.trim().toLowerCase()))].filter((a) => EMAIL_RE.test(a) && !mine.has(a));

  const startISO = `${input.start}:00`;
  const endIso = endISO(startISO, input.durationMinutes);
  const cal = await calendars(userId);
  const onGoogle = cal.google;
  const base = { title: input.title, startISO, endISO: endIso, timeZone: input.timeZone, attendees: invited };

  if (input.platform === "teams") {
    const r = await createOutlookEvent(userId, { ...base, description: input.description, teams: true });
    return { platform: "teams", calendar: "outlook", ...r, invited };
  }

  if (input.platform === "google_meet") {
    const r = await createCalendarEvent(userId, { ...base, description: input.description, addMeetLink: true, sendInvites: true });
    return { platform: "google_meet", calendar: "google", ...r, invited };
  }

  // Zoom's link, or the place, goes in a normal calendar invitation:
  // Google when connected, otherwise Outlook.
  let location = input.location?.trim() || undefined;
  let description = input.description;
  let zoomJoin: string | null = null;
  if (input.platform === "zoom") {
    // Check the calendar can take the invitation first, so a missing
    // permission never leaves an orphaned Zoom meeting behind.
    if (onGoogle && !cal.googleCanWrite) throw new NeedsGooglePermissionError("calendar_events");
    const zoom = await createZoomMeeting(userId, {
      title: input.title,
      agenda: input.description,
      startISO: input.start,
      timeZone: input.timeZone,
      durationMinutes: input.durationMinutes,
    });
    zoomJoin = zoom.joinUrl;
    location = zoom.joinUrl;
    description = `Join Zoom: ${zoom.joinUrl}\n\n${input.description}`;
  }
  if (onGoogle) {
    const r = await createCalendarEvent(userId, { ...base, description, location, addMeetLink: false, sendInvites: true });
    return { platform: input.platform, calendar: "google", openUrl: r.openUrl, joinUrl: zoomJoin, invited };
  }
  const r = await createOutlookEvent(userId, { ...base, description, location, teams: false });
  return { platform: input.platform, calendar: "outlook", openUrl: r.openUrl, joinUrl: zoomJoin, invited };
}
