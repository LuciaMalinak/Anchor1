// Anchor stores no per-user time zone, so pages send the browser's own
// (same approach as TodayMeetings.tsx). Anything Intl doesn't recognise
// falls back to UTC.
export function safeTimeZone(tz: string | undefined | null): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

// YYYY-MM-DD for a moment as seen in the given time zone.
export function localDateISO(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

// Wall-clock time in a time zone as YYYY-MM-DDTHH:MM, directly comparable
// with suggestion startISO strings.
export function localNowISO(timeZone: string): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  return `${localDateISO(new Date(), timeZone)}T${time}`;
}
