import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { contacts, deals, tasks, users } from "@/db/schema";
import type { ServerTool } from "@/lib/liveAssist";
import { authorizeDeal } from "@/lib/dealAccess";
import { getGoogleConnection, googleGet, NeedsGooglePermissionError } from "@/lib/integrations/google";
import { NeedsConnectionError } from "@/lib/integrations/onlineMeetings";
import { ConnectionExpiredError } from "@/lib/integrations/oauthConnection";
import { PLATFORM_LABEL, platformOptions, scheduleMeeting, type MeetingPlatform } from "@/lib/meetingScheduler";
import { isValidTimeZone } from "@/lib/morningBriefPrefs";

// Ask Anchor's scheduling tools: "set up a call with Jackie Thursday
// afternoon" is done for the person, not left to them. check_calendar reads
// their Google Calendar for a date range and works out free slots;
// schedule_meeting creates the event (with a Zoom, Google Meet or Teams
// link, or a place), invites people (names are matched to emails from
// their contacts and team), and notes it on the deal. Same machinery as
// the "Schedule a meeting" button (src/lib/meetingScheduler.ts).

const WORK_START = 9;
const WORK_END = 18;
const MAX_DAYS = 14;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Minutes the time zone is ahead of UTC at that instant.
function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60_000);
}

// Local wall time in the zone -> UTC milliseconds.
function zonedToUtc(date: string, hour: number, minute: number, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - tzOffsetMinutes(guess, timeZone) * 60_000;
  return guess - tzOffsetMinutes(first, timeZone) * 60_000;
}

function localLabel(utcMs: number, timeZone: string, withDay = true): string {
  return new Date(utcMs).toLocaleString("en-US", {
    timeZone,
    ...(withDay ? { weekday: "short", month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

function localDate(utcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(utcMs));
}

type CalendarEvent = {
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

function calendarTool(userId: string, timeZone: string): ServerTool {
  return {
    tool: {
      name: "check_calendar",
      description:
        "Read the person's Google Calendar between two dates (up to 14 days): their meetings, and their free slots during working hours (9am-6pm on weekdays, their time zone). Use it before scheduling whenever they haven't given an exact time, and to check a time they gave is free.",
      input_schema: {
        type: "object",
        properties: {
          from_date: { type: "string", description: "First day, YYYY-MM-DD, in their time zone." },
          to_date: { type: "string", description: "Last day, YYYY-MM-DD (same as from_date for one day)." },
          min_minutes: { type: "integer", description: "Shortest free slot worth listing. Default 30." },
        },
        required: ["from_date", "to_date"],
      },
    },
    async run(input) {
      const from = typeof input.from_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.from_date) ? input.from_date : null;
      const to = typeof input.to_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.to_date) ? input.to_date : from;
      if (!from || !to) return "Give from_date and to_date as YYYY-MM-DD.";
      const minMinutes = Math.max(15, Math.min(240, Number(input.min_minutes) || 30));
      const google = await getGoogleConnection(userId);
      if (!google) return "Google Calendar isn't connected, so the calendar can't be read. Tell the person to connect Google on the Integrations page.";
      const startMs = zonedToUtc(from, 0, 0, timeZone);
      let endMs = zonedToUtc(to, 23, 59, timeZone);
      if (endMs - startMs > MAX_DAYS * 86_400_000) endMs = startMs + MAX_DAYS * 86_400_000;
      const url =
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=250` +
        `&timeMin=${encodeURIComponent(new Date(startMs).toISOString())}&timeMax=${encodeURIComponent(new Date(endMs).toISOString())}`;
      const { json } = await googleGet(google, google.accessToken, url);
      const events = ((Array.isArray(json.items) ? json.items : []) as CalendarEvent[]).filter(
        (e) => e.status !== "cancelled" && !e.attendees?.some((a) => a.self && a.responseStatus === "declined")
      );
      const busy = events
        .filter((e) => e.transparency !== "transparent")
        .map((e) => ({
          s: e.start?.dateTime ? Date.parse(e.start.dateTime) : zonedToUtc(e.start?.date ?? from, 0, 0, timeZone),
          e: e.end?.dateTime ? Date.parse(e.end.dateTime) : zonedToUtc(e.end?.date ?? to, 0, 0, timeZone),
          title: e.summary || "(busy)",
          allDay: !e.start?.dateTime,
        }));

      const lines: string[] = [`Time zone: ${timeZone}.`];
      for (let day = startMs; day <= endMs; day += 86_400_000) {
        const date = localDate(day + 12 * 3_600_000, timeZone);
        if (lines.some((l) => l.startsWith(`${date} `))) continue;
        const dayStart = zonedToUtc(date, 0, 0, timeZone);
        const dayEnd = dayStart + 86_400_000;
        const weekday = new Date(dayStart + 12 * 3_600_000).toLocaleDateString("en-US", { timeZone, weekday: "short" });
        const todays = busy.filter((b) => b.s < dayEnd && b.e > dayStart).sort((a, b) => a.s - b.s);
        const meetingsText = todays.length
          ? todays.map((b) => (b.allDay ? `${b.title} (all day)` : `${localLabel(b.s, timeZone, false)}–${localLabel(b.e, timeZone, false)} ${b.title}`)).join("; ")
          : "no meetings";
        let free = "";
        if (!["Sat", "Sun"].includes(weekday)) {
          const workStart = Math.max(zonedToUtc(date, WORK_START, 0, timeZone), Date.now());
          const workEnd = zonedToUtc(date, WORK_END, 0, timeZone);
          const slots: string[] = [];
          let cursor = workStart;
          for (const b of todays.filter((x) => !x.allDay)) {
            if (b.s - cursor >= minMinutes * 60_000 && cursor < workEnd) slots.push(`${localLabel(cursor, timeZone, false)}–${localLabel(Math.min(b.s, workEnd), timeZone, false)}`);
            cursor = Math.max(cursor, b.e);
          }
          if (workEnd - cursor >= minMinutes * 60_000) slots.push(`${localLabel(cursor, timeZone, false)}–${localLabel(workEnd, timeZone, false)}`);
          free = slots.length ? ` | free: ${slots.join(", ")}` : " | free: none in working hours";
        }
        lines.push(`${date} ${weekday}: ${meetingsText}${free}`);
      }
      return lines.join("\n");
    },
  };
}

function scheduleTool(userId: string, timeZone: string): ServerTool {
  return {
    tool: {
      name: "schedule_meeting",
      description:
        "Schedule a meeting for the person: creates the calendar event with a Zoom / Google Meet / Teams link (or a place), sends invitations to the attendees, and adds it to the deal's to-dos. Use it when they ask you to schedule, set up, book or arrange a call or meeting. Attendees can be email addresses or names of their contacts or teammates.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title, e.g. \"Amanyara RFP — Satai intro\"." },
          start: { type: "string", description: "Local start time in the person's time zone, YYYY-MM-DDTHH:MM." },
          duration_minutes: { type: "integer", description: "Default 30." },
          attendees: { type: "array", items: { type: "string" }, description: "Emails, or names of contacts / teammates." },
          platform: { type: "string", enum: ["zoom", "google_meet", "teams", "in_person"] },
          location: { type: "string", description: "Address, for in_person." },
          description: { type: "string", description: "Short agenda for the invitation." },
          deal_name: { type: "string", description: "The deal it's for, if any." },
        },
        required: ["title", "start", "attendees", "platform"],
      },
    },
    async run(input) {
      const start = typeof input.start === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.start) ? input.start : null;
      if (!start) return "start must be YYYY-MM-DDTHH:MM in the person's time zone. Nothing was scheduled.";
      const platform = (["zoom", "google_meet", "teams", "in_person"] as MeetingPlatform[]).find((p) => p === input.platform);
      if (!platform) return "Pick a platform: zoom, google_meet, teams or in_person. Nothing was scheduled.";
      if (platform === "in_person" && !(typeof input.location === "string" && input.location.trim())) {
        return "An in-person meeting needs a location. Ask the person where. Nothing was scheduled.";
      }
      const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 200) : "Meeting";
      const durationMinutes = Math.min(480, Math.max(10, Number(input.duration_minutes) || 30));
      if (zonedToUtc(start.slice(0, 10), +start.slice(11, 13), +start.slice(14, 16), timeZone) < Date.now() - 5 * 60_000) {
        return `${start} (${timeZone}) is in the past. Nothing was scheduled.`;
      }

      // Names -> emails, from their contacts and their team.
      const [me] = await db.select({ teamId: users.teamId }).from(users).where(eq(users.id, userId));
      const wanted = (Array.isArray(input.attendees) ? input.attendees : []).filter((a): a is string => typeof a === "string" && a.trim() !== "");
      const emails: string[] = [];
      const unresolved: string[] = [];
      for (const raw of wanted) {
        const a = raw.trim();
        const inBrackets = /<([^>]+)>/.exec(a)?.[1];
        if (EMAIL_RE.test(inBrackets ?? a)) {
          emails.push((inBrackets ?? a).toLowerCase());
          continue;
        }
        const like = `%${a.replace(/[%_]/g, "")}%`;
        const [contactRows, teammates] = await Promise.all([
          db.select({ name: contacts.name, email: contacts.email }).from(contacts).where(and(eq(contacts.userId, userId), ilike(contacts.name, like))).limit(5),
          me?.teamId
            ? db.select({ name: users.name, email: users.email }).from(users).where(and(eq(users.teamId, me.teamId), or(ilike(users.name, like), ilike(users.email, like)))).limit(5)
            : Promise.resolve([] as { name: string | null; email: string | null }[]),
        ]);
        const found = [...new Map([...contactRows, ...teammates].filter((r) => r.email).map((r) => [r.email!.toLowerCase(), r])).values()];
        if (found.length === 1) emails.push(found[0].email!.toLowerCase());
        else unresolved.push(found.length > 1 ? `${a} (several matches: ${found.map((f) => `${f.name} <${f.email}>`).join(", ")})` : `${a} (no email on file)`);
      }
      if (unresolved.length) {
        return `Not scheduled yet: couldn't work out who to invite for ${unresolved.join("; ")}. Ask the person which address to use, then call schedule_meeting again.`;
      }

      try {
        const description = `${typeof input.description === "string" && input.description.trim() ? input.description.trim().slice(0, 2000) + "\n\n" : ""}Set up with Anchor.AI.`;
        const result = await scheduleMeeting(userId, {
          platform,
          title,
          description,
          start,
          durationMinutes,
          timeZone,
          attendees: emails,
          location: typeof input.location === "string" ? input.location.slice(0, 300) : undefined,
        });

        // On the deal's to-dos, like the "Schedule a meeting" button does.
        let dealNote = "";
        if (typeof input.deal_name === "string" && input.deal_name.trim() && me?.teamId) {
          const candidates = await db
            .select({ id: deals.id, name: deals.name, teamId: deals.teamId })
            .from(deals)
            .where(and(eq(deals.teamId, me.teamId), ilike(deals.name, `%${input.deal_name.trim().replace(/[%_]/g, "")}%`)))
            .limit(3);
          const access = await Promise.all(candidates.map((d) => authorizeDeal(userId, d.id)));
          const deal = candidates.filter((_, i) => access[i]);
          if (deal.length === 1) {
            await db.insert(tasks).values({
              teamId: deal[0].teamId,
              dealId: deal[0].id,
              text: `Meeting: ${title}, ${start.replace("T", " ")} (${timeZone})${result.joinUrl ? ` · ${result.joinUrl}` : ""}`.slice(0, 500),
              source: "manual",
              createdByUserId: userId,
            });
            dealNote = ` Added to the to-dos on "${deal[0].name}".`;
          }
        }
        const when = localLabel(zonedToUtc(start.slice(0, 10), +start.slice(11, 13), +start.slice(14, 16), timeZone), timeZone);
        return [
          `Scheduled "${title}" on ${when} (${timeZone}), ${durationMinutes} minutes, ${PLATFORM_LABEL[platform]}, on their ${result.calendar === "google" ? "Google" : "Outlook"} calendar.`,
          result.invited.length ? `Invitations sent to: ${result.invited.join(", ")}.` : "No one else was invited.",
          result.joinUrl ? `Join link: ${result.joinUrl}` : "",
          result.openUrl ? `Calendar event: ${result.openUrl}` : "",
          dealNote,
        ]
          .filter(Boolean)
          .join("\n");
      } catch (err) {
        if (err instanceof NeedsGooglePermissionError) {
          return `Not scheduled: Anchor.AI needs permission to add events to their Google Calendar. Give them this link: [Allow calendar events](/api/integrations/google/connect?add=${err.scopeKey}&returnTo=%2Fdashboard)`;
        }
        if (err instanceof ConnectionExpiredError) {
          const label = err.provider === "zoom" ? "Zoom" : err.provider === "microsoft" ? "Microsoft 365" : err.provider;
          return `Not scheduled: ${err.message} Give them this link to reconnect, then offer to try again (or use another platform that's connected): [Reconnect ${label}](/api/integrations/${err.provider}/connect?returnTo=%2Fdashboard)`;
        }
        if (err instanceof NeedsConnectionError) {
          return `Not scheduled: ${err.message} Give them this link: [Connect ${err.provider}](/api/integrations/${err.provider}/connect?returnTo=%2Fdashboard)`;
        }
        throw err;
      }
    },
  };
}

// The tools plus the system prompt lines that go with them.
export async function loadCalendarTools(userId: string, timeZoneRaw: string | null | undefined) {
  const timeZone = timeZoneRaw && isValidTimeZone(timeZoneRaw) ? timeZoneRaw : "America/New_York";
  const options = await platformOptions(userId, "/dashboard").catch(() => []);
  const available = options.filter((o) => o.available).map((o) => `${o.label} (${o.platform})`);
  const today = new Date().toLocaleDateString("en-US", { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const rules = `Scheduling: you can schedule meetings yourself with schedule_meeting and read the person's calendar with check_calendar. Today is ${today}; their time zone is ${timeZone}. When they ask you to schedule, set up, book or arrange a call or meeting, do it for them — never tell them to do it themselves:
1. Work out who: use email addresses from the context (deal contacts, email senders, attendees) or pass people's names; schedule_meeting matches names to their contacts and team.
2. Work out when: if they gave a time, use it (check_calendar first if you're unsure it's free and mention a clash). If they gave a rough window ("Thursday afternoon", "next week"), call check_calendar and pick the first free slot that fits. Turn relative dates into exact ones from today's date.
3. How: what they asked for; otherwise ${available.length ? `the first available of: ${available.join(", ")}` : "ask"}. Default length 30 minutes. Title it after the purpose and the company or deal.
4. Call schedule_meeting, with the deal's name when it's about a deal. Schedule several meetings with several calls when asked.
Only ask a short question first when who to invite is unclear or the time is genuinely ambiguous. Afterwards confirm in one or two lines: what, when (their time zone), who was invited, and the join link.`;
  return { tools: [calendarTool(userId, timeZone), scheduleTool(userId, timeZone)], rules };
}

// Exposed for tests.
export const _internal = { zonedToUtc, tzOffsetMinutes };
