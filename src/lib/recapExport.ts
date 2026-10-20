// A meeting's recap as text to send elsewhere after the call: a short
// Slack message for the deal's channel, and a Markdown file for the deal's
// Dropbox folder. Built straight from the saved summary (no model call),
// so it's instant and says exactly what the recap page says.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, meetings, summaries } from "@/db/schema";
import { siteUrl } from "@/lib/morningBrief";

export type RecapSource = {
  meetingId: string;
  title: string;
  occurredAt: Date;
  dealName: string | null;
  overview: string;
  keyPoints: string[];
  actionItems: { text: string; owner: string | null }[];
  dealSignals: { type: "buying_signal" | "risk" | "blocker"; detail: string }[];
};

// The recap for a meeting someone is already authorized to see, or null
// while it hasn't finished processing.
export async function loadRecap(
  meeting: typeof meetings.$inferSelect,
  deal: typeof deals.$inferSelect | null
): Promise<RecapSource | null> {
  const [summary] = await db.select().from(summaries).where(eq(summaries.meetingId, meeting.id));
  if (!summary) return null;
  return {
    meetingId: meeting.id,
    title: meeting.title,
    occurredAt: meeting.occurredAt,
    dealName: deal?.name ?? null,
    overview: summary.overview,
    keyPoints: summary.keyPoints,
    actionItems: summary.actionItems,
    dealSignals: summary.dealSignals,
  };
}

const SIGNAL_LABEL = { buying_signal: "Buying signal", risk: "Risk", blocker: "Blocker" } as const;

function day(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function recapUrl(meetingId: string): string {
  return `${siteUrl()}/dashboard/meetings/${meetingId}`;
}

// Slack mrkdwn treats &, < and > as control characters.
function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function slackRecapText(r: RecapSource): string {
  const e = slackEscape;
  const lines = [`*${e(r.title)}* · ${day(r.occurredAt)}`, e(r.overview)];
  if (r.keyPoints.length) lines.push("", "*Key points*", ...r.keyPoints.slice(0, 5).map((k) => `• ${e(k)}`));
  if (r.actionItems.length) {
    lines.push("", "*Next steps*", ...r.actionItems.map((a) => `• ${e(a.text)}${a.owner ? ` — _${e(a.owner)}_` : ""}`));
  }
  const flags = r.dealSignals.filter((s) => s.type !== "buying_signal");
  if (flags.length) lines.push("", ...flags.map((s) => `:warning: ${SIGNAL_LABEL[s.type]}: ${e(s.detail)}`));
  lines.push("", `<${recapUrl(r.meetingId)}|Full recap in Anchor>`);
  return lines.join("\n");
}

export function recapFileName(r: RecapSource): string {
  return `${r.occurredAt.toISOString().slice(0, 10)} ${r.title}.md`;
}

export function recapMarkdown(r: RecapSource, transcript: string | null): string {
  const lines = [`# ${r.title}`, "", `${day(r.occurredAt)}${r.dealName ? ` · ${r.dealName}` : ""}`, "", "## Overview", "", r.overview];
  if (r.keyPoints.length) lines.push("", "## Key points", "", ...r.keyPoints.map((k) => `- ${k}`));
  if (r.actionItems.length) {
    lines.push("", "## Action items", "", ...r.actionItems.map((a) => `- [ ] ${a.text}${a.owner ? ` — ${a.owner}` : ""}`));
  }
  if (r.dealSignals.length) lines.push("", "## Signals", "", ...r.dealSignals.map((s) => `- **${SIGNAL_LABEL[s.type]}:** ${s.detail}`));
  if (transcript?.trim()) lines.push("", "## Transcript", "", transcript.trim());
  lines.push("", "---", `Saved from Anchor: ${recapUrl(r.meetingId)}`, "");
  return lines.join("\n");
}
