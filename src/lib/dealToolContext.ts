import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts, deals, meetingParticipants, meetings, summaries, tasks } from "@/db/schema";

// Plain-text picture of one deal for the deal tools (nudge, pre-call
// brief): the same sources Ask Anchor's deal context uses, trimmed to what
// those prompts need. Callers must have already authorized the deal.

function clip(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export async function buildDealToolContext(deal: typeof deals.$inferSelect): Promise<{
  context: string;
  lastMeetingAt: Date | null;
}> {
  const [recent, people, openTasks] = await Promise.all([
    db
      .select({ meeting: meetings, summary: summaries })
      .from(meetings)
      .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
      .where(and(eq(meetings.dealId, deal.id), eq(meetings.status, "ready")))
      .orderBy(desc(meetings.occurredAt))
      .limit(3),
    db
      .selectDistinctOn([contacts.id], {
        name: contacts.name,
        role: contacts.role,
        company: contacts.company,
        relationshipSummary: contacts.relationshipSummary,
      })
      .from(meetingParticipants)
      .innerJoin(meetings, eq(meetingParticipants.meetingId, meetings.id))
      .innerJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
      .where(eq(meetings.dealId, deal.id)),
    db
      .select({ text: tasks.text, ownerLabel: tasks.ownerLabel })
      .from(tasks)
      .where(and(eq(tasks.dealId, deal.id), eq(tasks.completed, false)))
      .limit(15),
  ]);

  const parts: string[] = [`Deal: ${deal.name} — stage ${deal.stage}.`];
  if (deal.primaryContactName) {
    parts.push(`Main contact: ${deal.primaryContactName}${deal.primaryContactRole ? `, ${deal.primaryContactRole}` : ""}.`);
  }
  if (deal.memory) parts.push(`What Anchor remembers: ${clip(deal.memory, 1500)}`);
  if (deal.notes) parts.push(`Rep's notes: ${clip(deal.notes, 800)}`);
  if (deal.decisionBoundaries) parts.push(`Can decide on their own: ${clip(deal.decisionBoundaries, 400)}`);
  if (people.length) {
    parts.push(
      `People:\n${people
        .slice(0, 8)
        .map((p) => `- ${p.name}${p.role || p.company ? ` (${[p.role, p.company].filter(Boolean).join(", ")})` : ""}${p.relationshipSummary ? ` — ${clip(p.relationshipSummary, 200)}` : ""}`)
        .join("\n")}`
    );
  }
  for (const { meeting, summary } of recent) {
    parts.push(`Meeting "${meeting.title}" on ${meeting.occurredAt.toISOString().slice(0, 10)}: ${clip(summary.overview, 600)}`);
    if (summary.actionItems?.length) {
      parts.push(`  Action items: ${summary.actionItems.map((a) => `${a.text}${a.owner ? ` (${a.owner})` : ""}`).join("; ")}`);
    }
    if (summary.dealSignals?.length) {
      parts.push(`  Signals: ${summary.dealSignals.map((s) => `${s.type.replace("_", " ")}: ${s.detail}`).join("; ")}`);
    }
  }
  if (openTasks.length) {
    parts.push(`Open tasks: ${openTasks.map((t) => `${t.text}${t.ownerLabel ? ` (${t.ownerLabel})` : ""}`).join("; ")}`);
  }
  if (deal.emailContext) parts.push(`Recent emails: ${clip(deal.emailContext, 1200)}`);
  if (deal.calendarContext) parts.push(`Calendar: ${clip(deal.calendarContext, 600)}`);
  if (deal.newsHeadline) parts.push(`Company news: ${clip(deal.newsHeadline, 300)}`);
  if (deal.companyResearch) parts.push(`Company research: ${clip(deal.companyResearch, 800)}`);

  return { context: parts.join("\n"), lastMeetingAt: recent[0]?.meeting.occurredAt ?? null };
}
