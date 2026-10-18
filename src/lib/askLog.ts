import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { askLog, meetings } from "@/db/schema";

// Keeps what someone asked Ask Anchor with the call and deal it belongs
// to, so what they looked up during a meeting stays with that meeting
// (its page lists it) and with the deal. A question goes with the call
// they're in right now, if any; otherwise with the deal or meeting page
// they asked from. A general question outside any call isn't kept.

const LIVE_WITHIN_MS = 4 * 60 * 60 * 1000;
const MAX_ANSWER_CHARS = 8_000;

async function liveMeetingOf(userId: string): Promise<{ id: string; dealId: string | null } | null> {
  const [live] = await db
    .select({ id: meetings.id, dealId: meetings.dealId })
    .from(meetings)
    .where(
      and(
        eq(meetings.userId, userId),
        inArray(meetings.status, ["recording", "joining"]),
        gt(meetings.updatedAt, new Date(Date.now() - LIVE_WITHIN_MS))
      )
    )
    .orderBy(desc(meetings.updatedAt))
    .limit(1);
  return live ?? null;
}

export async function saveAsk(params: {
  userId: string;
  question: string;
  answer: string;
  dealId?: string | null;
  meetingId?: string | null;
}): Promise<void> {
  // Without the action markers Ask Anchor's answers can end with (see
  // askActions.ts, which is browser-only so can't be imported here).
  const answer = params.answer.replace(/\[\[anchor:[^\]]*\]\]/g, "").trim();
  if (!params.question.trim() || !answer) return;
  const live = await liveMeetingOf(params.userId);
  // Asked from a deal page during a call about a different deal: it's
  // about the page's deal, so not filed under that call.
  const liveFits = live && (!params.dealId || !live.dealId || live.dealId === params.dealId);
  const meetingId = params.meetingId ?? (liveFits ? live.id : null);
  const dealId = params.dealId ?? (liveFits ? live.dealId : null);
  if (!meetingId && !dealId) return;
  await db.insert(askLog).values({
    userId: params.userId,
    meetingId,
    dealId,
    question: params.question.trim().slice(0, 2000),
    answer: answer.slice(0, MAX_ANSWER_CHARS),
  });
}
