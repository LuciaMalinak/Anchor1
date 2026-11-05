import { safeTimeZone } from "@/lib/timeZone";

// What the LinkedIn bot posts and when. Stored as jsonb on linkedin_bot
// and normalized here on every read, so a missing or odd value always
// falls back to a working default.
export type LinkedInBotSettings = {
  // Master switch: nothing is written or posted while this is off.
  enabled: boolean;
  timeZone: string;
  // Local times ("HH:MM") for the daily posts, one post per time.
  postTimes: string[];
  // Day of the week for the video (0 = Sunday … 6 = Saturday) and its time.
  videoDay: number;
  videoTime: string;
  // What the posts are about; the bot rotates through them.
  topics: string[];
  // A few sentences on the company, so posts describe it accurately.
  about: string;
  // Companies and people in the sector to engage with (Comments tab).
  watchlist: string[];
};

export const DEFAULT_TOPICS = [
  "AI Anchor product tips: how to get more out of Anchor in real client work",
  "Deal and M&A insights: practical lessons from dealmaking and what's moving in the market",
  "AI for sales teams and advisors: how AI is changing client calls, follow-ups and meetings",
];

export const DEFAULT_ABOUT =
  "AI Anchor (Anchor) is an AI assistant for dealmakers, bankers, advisors and B2B sales teams. " +
  "It joins client calls, answers questions live during the call, writes the summary and follow-up afterwards, " +
  "keeps a running memory of every deal and contact, and sends a morning brief with the emails and tasks that need attention. " +
  "Founded by Lucia Malinak, a former investment banking associate.";

export const DEFAULT_SETTINGS: LinkedInBotSettings = {
  enabled: false,
  timeZone: "America/New_York",
  postTimes: ["09:00", "15:00"],
  videoDay: 3,
  videoTime: "12:00",
  topics: DEFAULT_TOPICS,
  about: DEFAULT_ABOUT,
  watchlist: [],
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanList(value: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, max);
}

export function normalizeSettings(raw: unknown): LinkedInBotSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const postTimes = cleanList(r.postTimes, 4, 5).filter((t) => TIME_RE.test(t));
  const topics = cleanList(r.topics, 8, 300);
  const videoDay = Number(r.videoDay);
  return {
    enabled: r.enabled === true,
    timeZone: safeTimeZone(typeof r.timeZone === "string" ? r.timeZone : DEFAULT_SETTINGS.timeZone),
    postTimes: postTimes.length ? [...new Set(postTimes)].sort() : DEFAULT_SETTINGS.postTimes,
    videoDay: Number.isInteger(videoDay) && videoDay >= 0 && videoDay <= 6 ? videoDay : DEFAULT_SETTINGS.videoDay,
    videoTime: typeof r.videoTime === "string" && TIME_RE.test(r.videoTime) ? r.videoTime : DEFAULT_SETTINGS.videoTime,
    topics: topics.length ? topics : DEFAULT_TOPICS,
    about: typeof r.about === "string" && r.about.trim() ? r.about.trim().slice(0, 2000) : DEFAULT_ABOUT,
    watchlist: cleanList(r.watchlist, 40, 120),
  };
}

// The UTC moment of a wall-clock date and time ("YYYY-MM-DD", "HH:MM")
// in a time zone, correct across daylight-saving changes.
export function zonedTime(dateISO: string, time: string, timeZone: string): Date {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall - offsetMs(new Date(wall), timeZone);
  guess = wall - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// Day of the week (0 = Sunday) of a local date.
export function weekday(dateISO: string): number {
  const [y, mo, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}
