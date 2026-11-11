import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, teams, users } from "@/db/schema";
import { logTeamActivity } from "@/lib/activityLog";

// The team owner's do-not-record list: clients, companies or email
// domains Anchor.AI must never record. Checked before the notetaker joins
// a call, before the desktop app starts recording and before an uploaded
// recording is processed. An entry matches the call's title, its deal's
// name, the deal's website or the deal contact's email domain.

export function cleanDoNotRecord(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  const out = new Set<string>();
  for (const e of entries) {
    if (typeof e !== "string") continue;
    const v = e.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/^@/, "");
    if (v.length >= 2 && v.length <= 120) out.add(v);
  }
  return [...out].slice(0, 200);
}

function host(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// The entry that blocks this call, or null when it may be recorded.
export async function doNotRecordMatch(userId: string, call: { title?: string | null; dealId?: string | null }): Promise<string | null> {
  const [row] = await db
    .select({ list: teams.doNotRecord })
    .from(users)
    .innerJoin(teams, eq(teams.id, users.teamId))
    .where(eq(users.id, userId));
  const list = cleanDoNotRecord(row?.list);
  if (!list.length) return null;

  const haystack: string[] = [];
  if (call.title) haystack.push(call.title.toLowerCase());
  if (call.dealId) {
    const [deal] = await db
      .select({ name: deals.name, website: deals.companyWebsite, email: deals.primaryContactEmail })
      .from(deals)
      .where(eq(deals.id, call.dealId));
    if (deal) {
      haystack.push(deal.name.toLowerCase(), host(deal.website));
      const domain = deal.email?.split("@")[1]?.toLowerCase();
      if (domain) haystack.push(domain);
    }
  }
  return list.find((entry) => haystack.some((h) => h && h.includes(entry))) ?? null;
}

// Checks the list and, when the call is blocked, records it in the
// activity log. Returns a message for the person, or null to go ahead.
export async function blockedByDoNotRecord(
  userId: string,
  call: { title?: string | null; dealId?: string | null },
  via: string,
): Promise<string | null> {
  const matched = await doNotRecordMatch(userId, call);
  if (!matched) return null;
  await logTeamActivity(userId, "recording_blocked", call.dealId ?? null, { title: call.title ?? null, matched, via });
  return `Your team doesn't record calls with "${matched}" (the do-not-record list on the Team page), so Anchor.AI won't record this one.`;
}
