// Each person's Morning brief settings (Profile page), and the rules for
// when their brief is due. Kept free of database imports so
// scripts/test-next-steps.ts can run it.

export type BriefChannel = "email" | "sms" | "slack";

export type MorningBriefPrefs = {
  hour: number; // 0-23, in timeZone
  minute: 0 | 30;
  timeZone: string; // IANA, e.g. "America/New_York"
  days: "weekdays" | "everyday";
  channel: BriefChannel;
  include: { emails: boolean; tasks: boolean; meetings: boolean; quietDeals: boolean };
  // "deals": only emails from people on the person's deals; "all": anything
  // that looks like it needs a reply.
  emailScope: "all" | "deals";
  lookbackDays: 7 | 14;
  // How often an email still waiting on a reply comes back in the brief.
  remindEveryDays: 1 | 2 | 3;
  // Put a suggested reply for the top emails in Gmail drafts.
  draftReplies: boolean;
};

export const DEFAULT_PREFS: MorningBriefPrefs = {
  hour: 8,
  minute: 0,
  timeZone: "America/New_York",
  days: "weekdays",
  channel: "email",
  include: { emails: true, tasks: true, meetings: true, quietDeals: true },
  emailScope: "all",
  lookbackDays: 14,
  remindEveryDays: 1,
  // Only takes effect once Anchor may create Gmail drafts.
  draftReplies: true,
};

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Fills in anything missing or invalid with the defaults, so a stored
// value from an older version (or a bad request) can never break a send.
export function normalizePrefs(raw: unknown): MorningBriefPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const inc = (r.include && typeof r.include === "object" ? r.include : {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const hour = Number(r.hour);
  return {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_PREFS.hour,
    minute: r.minute === 30 ? 30 : 0,
    timeZone: isValidTimeZone(r.timeZone) ? r.timeZone : DEFAULT_PREFS.timeZone,
    days: r.days === "everyday" ? "everyday" : "weekdays",
    channel: r.channel === "sms" || r.channel === "slack" ? r.channel : "email",
    include: {
      emails: bool(inc.emails, true),
      tasks: bool(inc.tasks, true),
      meetings: bool(inc.meetings, true),
      quietDeals: bool(inc.quietDeals, true),
    },
    emailScope: r.emailScope === "deals" ? "deals" : "all",
    lookbackDays: r.lookbackDays === 7 ? 7 : 14,
    remindEveryDays: r.remindEveryDays === 2 ? 2 : r.remindEveryDays === 3 ? 3 : 1,
    draftReplies: bool(r.draftReplies, DEFAULT_PREFS.draftReplies),
  };
}

// The person's local calendar date (YYYY-MM-DD), weekday (0 = Sunday) and
// minutes past midnight right now.
export function localNow(timeZone: string, now: Date = new Date()): { date: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

// Due once per local day, at or after the chosen time (the hourly job can
// run a little late), on the chosen days, and never twice the same day.
// A brief that's more than 3 hours late is skipped rather than sent at
// lunchtime.
export function isBriefDue(prefs: MorningBriefPrefs, lastSentOn: string | null, now: Date = new Date()) {
  const local = localNow(prefs.timeZone, now);
  const target = prefs.hour * 60 + prefs.minute;
  const isWeekend = local.weekday === 0 || local.weekday === 6;
  const due =
    lastSentOn !== local.date &&
    !(prefs.days === "weekdays" && isWeekend) &&
    local.minutes >= target &&
    local.minutes < target + 180;
  return { due, localDate: local.date };
}

// Whole days between two YYYY-MM-DD dates (b - a).
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
