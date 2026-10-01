import { db } from "@/db";
import { meetings, summaries, dealFiles, deals } from "@/db/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDealLeadStyle } from "@/lib/styleProfile";
import { summarizeDealFiles } from "@/lib/dealFilesContext";

// How many of this deal's past FINISHED meetings to ground live coaching
// in — same idea as assist/route.ts's recentReady, just smaller since
// this runs every few seconds during a live call.
const PAST_MEETINGS_LIMIT = 3;

export type LiveDealContext = {
  dealName: string | null;
  dealMemory: string | null;
  decisionBoundaries: string | null;
  leadStyle: string | null;
  notes: string | null;
  emailContext: string | null;
  calendarContext: string | null;
  documentContext: string | null;
  attachedFiles: string | null;
  pastMeetings: {
    title: string;
    occurredAt: string;
    overview: string;
    dealSignals: { type: "buying_signal" | "risk" | "blocker"; detail: string }[];
  }[];
};

// Everything known about a deal that live coaching and live question
// answers are grounded in. Shared by the periodic coaching refresh
// (api/meetings/[id]/live) and the instant question path
// (liveQuestion.ts) so both see exactly the same facts. `deal` must
// already be access-checked by the caller (null = no deal context).
export async function loadLiveDealContext(
  meetingId: string,
  deal: typeof deals.$inferSelect | null
): Promise<LiveDealContext> {
  // Never rebuilt synchronously here — this runs every few seconds
  // during a live call, so it reads whatever style profile already
  // exists (possibly a day stale) rather than ever waiting on a rebuild.
  const [leadStyle, pastMeetingRows, fileRows] = await Promise.all([
    getDealLeadStyle(deal?.leadUserId ?? null, { allowSynchronousRebuild: false }),
    deal
      ? db
          .select({ meeting: meetings, summary: summaries })
          .from(meetings)
          .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
          .where(
            and(eq(meetings.dealId, deal.id), eq(meetings.status, "ready"), ne(meetings.id, meetingId))
          )
          .orderBy(desc(meetings.occurredAt))
          .limit(PAST_MEETINGS_LIMIT)
      : Promise.resolve([]),
    // Files/voice notes attached from the Before tab's "Give Anchor more
    // context" box (see DealContextBox.tsx) — a bounded digest, not the
    // full text (see dealFilesContext.ts for why).
    deal ? db.select().from(dealFiles).where(eq(dealFiles.dealId, deal.id)) : Promise.resolve([]),
  ]);

  return {
    dealName: deal?.name || null,
    dealMemory: deal?.memory || null,
    decisionBoundaries: deal?.decisionBoundaries || null,
    leadStyle,
    notes: deal?.notes || null,
    // Already cached on the deal row (refreshed at most every 6h — see
    // src/lib/dealIntegrationContext.ts), so this adds zero extra latency.
    emailContext: deal?.emailContext || null,
    calendarContext: deal?.calendarContext || null,
    documentContext: deal?.documentContext || null,
    attachedFiles: summarizeDealFiles(fileRows),
    pastMeetings: pastMeetingRows.map((r) => ({
      title: r.meeting.title,
      occurredAt: r.meeting.occurredAt.toLocaleDateString(),
      overview: r.summary.overview,
      dealSignals: r.summary.dealSignals,
    })),
  };
}
