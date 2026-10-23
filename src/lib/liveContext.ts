import { db } from "@/db";
import { meetings, summaries, dealFiles, deals, teams } from "@/db/schema";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDealLeadStyle } from "@/lib/styleProfile";
import { summarizeDealFiles } from "@/lib/dealFilesContext";
import { isIndustryKey, type IndustryKey } from "@/lib/industries";
import type { IndustryPlaybook } from "@/lib/industryPlaybooks";
import { teamPlaybook, toolsForTeam } from "@/lib/teamSpecialty";

// How many of this deal's past FINISHED meetings to ground live coaching
// in — same idea as assist/route.ts's recentReady, just smaller since
// this runs every few seconds during a live call.
const PAST_MEETINGS_LIMIT = 3;
const FEEDBACK_NOTES_LIMIT = 5;
const TOOL_GAPS_LIMIT = 8;

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
  // What the person on this call told Anchor after their recent calls
  // ("too generic", "shorter answers"…) — see CallFeedbackPopup.
  feedbackNotes: string[];
  // The team's industry (Team page), which brings in that industry's
  // playbook: its checklist, rules and jargon (industryPlaybooks.ts).
  industry: IndustryKey | null;
  // The playbook calls are coached with: the team's own specialty's when
  // it has one, otherwise its industry's (teamSpecialty.ts).
  playbook: IndustryPlaybook | null;
  // What the deal's industry reports (buyer log, VAC packet, MEDDPICC…)
  // are still missing, so the call can fill it in (industryTools.ts).
  toolGaps: { tool: string; gap: string }[];
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
  const [leadStyle, pastMeetingRows, fileRows, feedbackRows, teamRows] = await Promise.all([
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
    db
      .select({ feedback: meetings.callFeedback })
      .from(meetings)
      .where(
        and(
          eq(meetings.userId, sql`(select "userId" from "meeting" where "id" = ${meetingId})`),
          sql`coalesce(${meetings.callFeedback}->>'note', '') <> ''`
        )
      )
      .orderBy(desc(meetings.occurredAt))
      .limit(FEEDBACK_NOTES_LIMIT),
    // The deal's team, or the team of whoever's on the call when there's no deal.
    db
      .select({ industry: teams.industry, specialty: teams.specialty })
      .from(teams)
      .where(
        deal
          ? eq(teams.id, deal.teamId)
          : sql`${teams.id} = (select u."teamId" from "user" u join "meeting" m on m."userId" = u."id" where m."id" = ${meetingId})`
      )
      .limit(1),
  ]);
  const industryRaw = teamRows[0]?.industry;
  const industry = industryRaw && isIndustryKey(industryRaw) ? industryRaw : null;
  const specialty = teamRows[0]?.specialty ?? null;
  const toolName = new Map(toolsForTeam(industry, specialty).map((t) => [t.id, t.name]));

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
    feedbackNotes: feedbackRows.map((r) => r.feedback?.note?.trim() ?? "").filter(Boolean),
    industry,
    playbook: teamPlaybook(industry, specialty),
    toolGaps: Object.entries(deal?.toolReports ?? {})
      .sort(([, a], [, b]) => b.generatedAt.localeCompare(a.generatedAt))
      .flatMap(([toolId, saved]) =>
        saved.report.gaps.slice(0, 3).map((gap) => ({ tool: toolName.get(toolId) ?? saved.report.title, gap }))
      )
      .slice(0, TOOL_GAPS_LIMIT),
    pastMeetings: pastMeetingRows.map((r) => ({
      title: r.meeting.title,
      occurredAt: r.meeting.occurredAt.toLocaleDateString(),
      overview: r.summary.overview,
      dealSignals: r.summary.dealSignals,
    })),
  };
}

// Live coaching refreshes every couple of seconds and every question
// triggers an instant answer, and both used to reload the full deal
// context (deal-lead style profile, past meetings + summaries, attached
// files) from the database first — several round trips before the AI
// call could even start. None of it changes mid-call in a way that
// matters for a live nudge, so keep it for a short while per meeting.
// In-memory is fine: a miss (restart, another instance) just reloads.
const CONTEXT_TTL_MS = 60_000;
const contextCache = new Map<string, { at: number; value: Promise<LiveDealContext> }>();

export function loadLiveDealContextCached(
  meetingId: string,
  deal: typeof deals.$inferSelect | null
): Promise<LiveDealContext> {
  const key = `${meetingId}:${deal?.id ?? ""}:${deal?.updatedAt.getTime() ?? ""}`;
  const hit = contextCache.get(key);
  if (hit && Date.now() - hit.at < CONTEXT_TTL_MS) return hit.value;
  const value = loadLiveDealContext(meetingId, deal);
  contextCache.set(key, { at: Date.now(), value });
  // A failed load shouldn't be served from the cache for the next minute.
  value.catch(() => contextCache.delete(key));
  for (const [k, v] of contextCache) {
    if (Date.now() - v.at > CONTEXT_TTL_MS) contextCache.delete(k);
  }
  return value;
}
