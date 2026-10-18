import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { deals, meetingLiveSegments, meetings } from "@/db/schema";
import { canAccessDeal } from "@/lib/dealAccess";
import { dealSearchTerm } from "@/lib/integrations/documentSearch";
import { getOrCreateTeamId } from "@/lib/team";

// Which of the team's deals a recording is about, from what was said in
// it: the company's name, the deal's full name, its main contact. Used for
// recordings started without a deal (the in-person recorder on Home, an
// upload from Home), so they still land on the right deal, live and after
// the call. Only a clear winner counts; a wrong deal is worse than none.

// The company named twice, the company and its contact, or the contact
// twice. One passing mention of a company isn't enough.
const MIN_SCORE = 8;
const MIN_LEAD = 3;
// Company terms too common to mean anything on their own.
const TOO_GENERIC = new Set(["new", "the", "test", "deal", "demo", "call", "meeting", "team", "project", "company", "inc", "ltd", "llc"]);

function countMentions(text: string, phrase: string, cap: number): number {
  const p = phrase.trim();
  if (p.length < 3 || TOO_GENERIC.has(p.toLowerCase())) return 0;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");
  return Math.min(cap, (text.match(re) ?? []).length);
}

export type DealMatch = { dealId: string; dealName: string };

export async function matchDealFromText(userId: string, text: string): Promise<DealMatch | null> {
  if (!text.trim()) return null;
  const teamId = await getOrCreateTeamId(userId);
  const teamDeals = await db.select().from(deals).where(eq(deals.teamId, teamId));
  if (!teamDeals.length) return null;

  const scored = teamDeals
    .map((deal) => {
      const company = dealSearchTerm(deal.name);
      const score =
        countMentions(text, company, 3) * 5 +
        (deal.name.trim() !== company ? countMentions(text, deal.name, 2) * 3 : 0) +
        (deal.primaryContactName ? countMentions(text, deal.primaryContactName, 2) * 4 : 0);
      return { deal, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const [best, second] = scored;
  if (!best || best.score < MIN_SCORE || (second && best.score - second.score < MIN_LEAD)) return null;
  if (!(await canAccessDeal(userId, best.deal.id, best.deal.teamId, best.deal))) return null;
  return { dealId: best.deal.id, dealName: best.deal.name };
}

// While a call without a deal is live: try to match it from what's been
// said so far, so live answers and coaching use that deal's facts from
// then on. Checked at most every LIVE_RETRY_MS per call; never replaces a
// deal someone already set.
const LIVE_RETRY_MS = 20_000;
const lastLiveTry = new Map<string, number>();

export async function matchLiveMeetingToDeal(meetingId: string): Promise<void> {
  const now = Date.now();
  if (now - (lastLiveTry.get(meetingId) ?? 0) < LIVE_RETRY_MS) return;
  lastLiveTry.set(meetingId, now);
  if (lastLiveTry.size > 1000) lastLiveTry.clear();

  const [meeting] = await db
    .select({ userId: meetings.userId, dealId: meetings.dealId, status: meetings.status, title: meetings.title })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  if (!meeting || meeting.dealId || (meeting.status !== "recording" && meeting.status !== "joining")) return;
  const lines = await db
    .select({ text: meetingLiveSegments.text })
    .from(meetingLiveSegments)
    .where(eq(meetingLiveSegments.meetingId, meetingId));
  const match = await matchDealFromText(meeting.userId, [meeting.title ?? "", ...lines.map((l) => l.text)].join("\n"));
  if (!match) return;
  await db
    .update(meetings)
    .set({ dealId: match.dealId, updatedAt: new Date() })
    .where(and(eq(meetings.id, meetingId), isNull(meetings.dealId)));
  console.log(`[dealMatch] live meeting ${meetingId} matched to "${match.dealName}"`);
}
