import { and, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { ensureAiUsageTable } from "@/lib/aiUsage";

// What AI and transcription actually cost, from the ai_usage table (see
// src/lib/aiUsage.ts), for the admin page.

export const COST_WINDOW_DAYS = 30;

export const FEATURE_LABELS: Record<string, string> = {
  live_coaching: "Live suggestions",
  live_questions: "Live question answers",
  live_transcription: "Live transcript (AssemblyAI)",
  transcription: "Transcription after calls (AssemblyAI)",
  meeting_summaries: "Summaries, memory & follow-ups",
  ask_anchor: "Ask Anchor",
  deal_tools: "Nudge emails, briefs & CRM updates",
  insights: "Insights",
  handoff_briefing: "Handoff briefings",
  company_research: "Company research",
  email_digest: "Email digests",
  style_profile: "Style profiles",
  linkedin_import: "LinkedIn import",
  daily_briefing: "Daily briefing (shared)",
  industry_news: "Industry news (shared)",
};

export type AiCostSummary = {
  totalUsd: number;
  byFeature: { feature: string; label: string; usd: number; calls: number }[];
  byUser: Map<string, number>;
  // Cost not tied to any member (shared news, background jobs).
  unattributedUsd: number;
  // Hours of meetings transcribed after the call, and everything charged
  // to a meeting divided by them — the number that matters for pricing.
  meetingHours: number;
  usdPerMeetingHour: number | null;
};

export async function loadAiCosts(): Promise<AiCostSummary | null> {
  try {
    await ensureAiUsageTable();
    const since = new Date(Date.now() - COST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recent = gte(aiUsage.createdAt, since);
    const [features, users, meetingTotals] = await Promise.all([
      db
        .select({
          feature: aiUsage.feature,
          usd: sql<number>`sum(${aiUsage.costUsd})`,
          calls: sql<number>`count(*)`,
        })
        .from(aiUsage)
        .where(recent)
        .groupBy(aiUsage.feature),
      db
        .select({ userId: aiUsage.userId, usd: sql<number>`sum(${aiUsage.costUsd})` })
        .from(aiUsage)
        .where(recent)
        .groupBy(aiUsage.userId),
      db
        .select({
          usd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)`,
          transcribedSeconds: sql<number>`coalesce(sum(case when ${aiUsage.feature} = 'transcription' then ${aiUsage.audioSeconds} else 0 end), 0)`,
        })
        .from(aiUsage)
        .where(and(recent, isNotNull(aiUsage.meetingId))),
    ]);

    const byFeature = features
      .map((f) => ({
        feature: f.feature,
        label: FEATURE_LABELS[f.feature] ?? f.feature,
        usd: Number(f.usd),
        calls: Number(f.calls),
      }))
      .sort((a, b) => b.usd - a.usd);
    const byUser = new Map<string, number>();
    let unattributedUsd = 0;
    for (const u of users) {
      if (u.userId) byUser.set(u.userId, Number(u.usd));
      else unattributedUsd += Number(u.usd);
    }
    const meetingHours = Number(meetingTotals[0]?.transcribedSeconds ?? 0) / 3600;
    return {
      totalUsd: byFeature.reduce((sum, f) => sum + f.usd, 0),
      byFeature,
      byUser,
      unattributedUsd,
      meetingHours,
      usdPerMeetingHour: meetingHours >= 0.25 ? Number(meetingTotals[0]?.usd ?? 0) / meetingHours : null,
    };
  } catch (err) {
    // The admin page should still load if this can't.
    console.error("[aiCosts] couldn't load AI costs:", err);
    return null;
  }
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(usd >= 100 ? 0 : 2)}`;
}
