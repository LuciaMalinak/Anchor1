// The asking person's own inbox and agenda, for the app-wide Ask Anchor
// panel ("check my emails", "what's on my agenda today"). Read-only, using
// the Google connection's default gmail.readonly / calendar.readonly
// scopes. Unlike gmail.ts / calendar.ts, which only look at mail and
// events matching a deal's contacts, this is everything in the window.
import { getGoogleConnection, googleGet } from "./google";

const INBOX_LOOKBACK_DAYS = 3;
const MAX_INBOX_EMAILS = 15;
const AGENDA_LOOKBACK_HOURS = 2;
const AGENDA_LOOKAHEAD_HOURS = 36;

export type PersonalGoogleContext = {
  connected: boolean;
  agenda: string | null; // formatted lines, or null if nothing in the window
  inbox: string | null;
  errors: string[]; // what couldn't be read, to tell the model honestly
};

function formatWhen(iso: string, timeZone: string, allDay: boolean): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" });
  if (allDay) return `${day} (all day)`;
  return `${day} ${d.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })}`;
}

type CalendarEvent = {
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[];
  location?: string;
  hangoutLink?: string;
};

async function fetchAgenda(
  connection: NonNullable<Awaited<ReturnType<typeof getGoogleConnection>>>,
  timeZone: string
): Promise<string | null> {
  const timeMin = new Date(Date.now() - AGENDA_LOOKBACK_HOURS * 3_600_000).toISOString();
  const timeMax = new Date(Date.now() + AGENDA_LOOKAHEAD_HOURS * 3_600_000).toISOString();
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
    `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
    `&singleEvents=true&orderBy=startTime&maxResults=30`;
  const { json } = await googleGet(connection, connection.accessToken, url);
  const events = (Array.isArray(json.items) ? (json.items as CalendarEvent[]) : []).filter(
    (e) => e.status !== "cancelled" && !e.attendees?.some((a) => a.self && a.responseStatus === "declined")
  );
  if (events.length === 0) return null;
  return events
    .map((e) => {
      const allDay = !e.start?.dateTime;
      const when = formatWhen(e.start?.dateTime || `${e.start?.date}T00:00:00`, timeZone, allDay);
      const others = (e.attendees ?? []).filter((a) => !a.self).map((a) => a.displayName || a.email).filter(Boolean);
      const extras = [
        others.length ? `with ${others.slice(0, 6).join(", ")}${others.length > 6 ? ` +${others.length - 6}` : ""}` : null,
        e.hangoutLink ? `join: ${e.hangoutLink}` : e.location ? `at ${e.location}` : null,
      ].filter(Boolean);
      return `— ${when}: ${e.summary || "(no title)"}${extras.length ? ` (${extras.join("; ")})` : ""}`;
    })
    .join("\n");
}

type GmailHeader = { name: string; value: string };

async function fetchInbox(connection: NonNullable<Awaited<ReturnType<typeof getGoogleConnection>>>): Promise<string | null> {
  const q = `in:inbox newer_than:${INBOX_LOOKBACK_DAYS}d -category:promotions -category:social`;
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${MAX_INBOX_EMAILS}&q=${encodeURIComponent(q)}`;
  const { json: list, accessToken } = await googleGet(connection, connection.accessToken, listUrl);
  const ids = Array.isArray(list.messages)
    ? (list.messages as { id?: string }[]).map((m) => m.id).filter((id): id is string => Boolean(id))
    : [];
  if (ids.length === 0) return null;

  const messages = await Promise.all(
    ids.map(async (id) => {
      try {
        const url =
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata` +
          `&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
        const { json } = await googleGet(connection, accessToken, url);
        const headers = ((json.payload as { headers?: GmailHeader[] } | undefined)?.headers ?? []) as GmailHeader[];
        const h = (name: string) => headers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value || "";
        const unread = Array.isArray(json.labelIds) && (json.labelIds as string[]).includes("UNREAD");
        const snippet = typeof json.snippet === "string" ? json.snippet : "";
        return `— ${unread ? "[unread] " : ""}${h("Subject") || "(no subject)"} — from ${h("From")}, ${h("Date")}\n  ${snippet}`;
      } catch {
        return null;
      }
    })
  );
  const lines = messages.filter((m): m is string => Boolean(m));
  return lines.length ? lines.join("\n") : null;
}

// Never throws: a missing connection or an API failure just comes back as
// "not connected" or an entry in `errors`, so the answer can say so.
export async function fetchPersonalGoogleContext(userId: string, timeZone: string): Promise<PersonalGoogleContext> {
  const connection = await getGoogleConnection(userId).catch(() => null);
  if (!connection) return { connected: false, agenda: null, inbox: null, errors: [] };
  const errors: string[] = [];
  const [agenda, inbox] = await Promise.all([
    fetchAgenda(connection, timeZone).catch((err) => {
      console.error("[personalGoogle] calendar read failed:", err);
      errors.push("calendar");
      return null;
    }),
    fetchInbox(connection).catch((err) => {
      console.error("[personalGoogle] inbox read failed:", err);
      errors.push("inbox");
      return null;
    }),
  ]);
  return { connected: true, agenda, inbox, errors };
}

export function formatPersonalGoogleContext(ctx: PersonalGoogleContext, timeZone: string): string {
  if (!ctx.connected) {
    return "Their Google account (Gmail + Calendar) isn't connected, so you can't see their inbox or calendar. If they ask about either, say so and suggest connecting Google on the Integrations page.";
  }
  const parts = [
    `Their Google Calendar, from 2 hours ago through the next 36 hours (times in ${timeZone}):\n${
      ctx.agenda ?? (ctx.errors.includes("calendar") ? "(couldn't be read just now)" : "(nothing scheduled)")
    }`,
    `Their Gmail inbox, last ${INBOX_LOOKBACK_DAYS} days, newest first (subject, sender, date, preview):\n${
      ctx.inbox ?? (ctx.errors.includes("inbox") ? "(couldn't be read just now)" : "(no new mail)")
    }`,
  ];
  return parts.join("\n\n");
}
