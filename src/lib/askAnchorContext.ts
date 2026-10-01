import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { contacts, deals, meetingParticipants, meetings, summaries, tasks, transcripts, users } from "@/db/schema";
import { accessibleDealIds, dealVisibilityWhere } from "@/lib/dealAccess";
import { computeDealHealth, daysSinceActivity, HEALTH_LABEL } from "@/lib/dealHealth";
import { authorizeMeeting } from "@/lib/meetingAccess";

// Context for the app-wide Ask Anchor panel (see AskAnchorDock.tsx and
// /api/ask). Deal pages keep using the richer per-deal context in
// /api/deals/[id]/assist; this covers everything else: the home page,
// the deals list, insights, contacts, team, and a single meeting's recap.
// Only ever built from what this user can already see (dealAccess rules),
// and capped so a large team still fits comfortably in one prompt.

const MAX_DEALS = 40;
const MAX_MEETINGS = 15;
const MAX_TASKS = 40;
const MAX_CONTACTS = 40;
const MAX_TRANSCRIPT_CHARS = 60_000;

function clip(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function buildWorkspaceContext(userId: string): Promise<string | null> {
  const access = await accessibleDealIds(userId);
  if (!access) return null;

  const [me] = await db.select().from(users).where(eq(users.id, userId));
  const teamMembers = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.teamId, access.teamId));
  const nameOf = (id: string | null) => {
    if (!id) return null;
    const u = teamMembers.find((m) => m.id === id);
    return u ? u.name || u.email : null;
  };

  const dealRows = await db
    .select()
    .from(deals)
    .where(dealVisibilityWhere(access))
    .orderBy(desc(deals.updatedAt))
    .limit(MAX_DEALS);
  const dealIds = dealRows.map((d) => d.id);
  const dealName = new Map(dealRows.map((d) => [d.id, d.name]));

  const meetingVisible = dealIds.length
    ? or(eq(meetings.userId, userId), inArray(meetings.dealId, dealIds))
    : eq(meetings.userId, userId);

  const [recent, upcoming, openTasks, people, lastActivity] = await Promise.all([
    db
      .select({ meeting: meetings, summary: summaries })
      .from(meetings)
      .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
      .where(and(meetingVisible, eq(meetings.status, "ready")))
      .orderBy(desc(meetings.occurredAt))
      .limit(MAX_MEETINGS),
    db
      .select({ title: meetings.title, scheduledAt: meetings.scheduledAt, dealId: meetings.dealId })
      .from(meetings)
      .where(and(meetingVisible, gte(meetings.scheduledAt, new Date())))
      .orderBy(meetings.scheduledAt)
      .limit(10),
    db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.teamId, access.teamId),
          eq(tasks.completed, false),
          dealIds.length ? or(isNull(tasks.dealId), inArray(tasks.dealId, dealIds)) : isNull(tasks.dealId)
        )
      )
      .orderBy(desc(tasks.createdAt))
      .limit(MAX_TASKS),
    db
      .select()
      .from(contacts)
      .where(eq(contacts.userId, userId))
      .orderBy(desc(contacts.lastMeetingAt))
      .limit(MAX_CONTACTS),
    dealIds.length
      ? db
          .select({ dealId: meetings.dealId, occurredAt: meetings.occurredAt })
          .from(meetings)
          .where(inArray(meetings.dealId, dealIds))
      : Promise.resolve([] as { dealId: string | null; occurredAt: Date }[]),
  ]);

  const lastByDeal = new Map<string, Date>();
  for (const m of lastActivity) {
    if (!m.dealId) continue;
    const prev = lastByDeal.get(m.dealId);
    if (!prev || m.occurredAt > prev) lastByDeal.set(m.dealId, m.occurredAt);
  }

  const parts: string[] = [];
  parts.push(`Today is ${day(new Date())}. You are helping ${me?.name || me?.email || "this user"}.`);

  parts.push(`\nTeam members: ${teamMembers.map((m) => m.name || m.email).join(", ") || "just this user"}.`);

  if (dealRows.length) {
    parts.push("\nDeals this user can see:");
    for (const d of dealRows) {
      const last = lastByDeal.get(d.id) ?? null;
      const health = computeDealHealth({ stage: d.stage, lastActivityAt: last, createdAt: d.createdAt });
      const since = daysSinceActivity({ lastActivityAt: last, createdAt: d.createdAt });
      const line = [
        `- ${d.name} — stage: ${d.stage}; health: ${HEALTH_LABEL[health]} (${since} days since last meeting)`,
        nameOf(d.leadUserId) ? `lead: ${nameOf(d.leadUserId)}` : null,
        nameOf(d.backupUserId) ? `backup: ${nameOf(d.backupUserId)}` : null,
        d.primaryContactName ? `main contact: ${d.primaryContactName}${d.primaryContactRole ? ` (${d.primaryContactRole})` : ""}` : null,
      ]
        .filter(Boolean)
        .join("; ");
      parts.push(line);
      if (d.memory) parts.push(`  What Anchor remembers: ${clip(d.memory, 600)}`);
      if (d.notes) parts.push(`  Notes: ${clip(d.notes, 300)}`);
      if (d.newsHeadline) parts.push(`  Recent news: ${clip(d.newsHeadline, 200)}`);
    }
  } else {
    parts.push("\nThis user has no deals yet.");
  }

  if (recent.length) {
    parts.push("\nRecent meetings (newest first):");
    for (const { meeting, summary } of recent) {
      const deal = meeting.dealId ? dealName.get(meeting.dealId) : null;
      parts.push(`- ${day(meeting.occurredAt)} · "${meeting.title}"${deal ? ` · deal: ${deal}` : ""}`);
      parts.push(`  Summary: ${clip(summary.overview, 500)}`);
      const items = (summary.actionItems ?? []).map((a) => (a.owner ? `${a.text} (${a.owner})` : a.text));
      if (items.length) parts.push(`  Action items: ${clip(items.join("; "), 500)}`);
      const signals = (summary.dealSignals ?? []).map((s) => `${s.type.replace("_", " ")}: ${s.detail}`);
      if (signals.length) parts.push(`  Signals: ${clip(signals.join("; "), 400)}`);
    }
  }

  if (upcoming.length) {
    parts.push("\nUpcoming scheduled calls:");
    for (const u of upcoming) {
      const deal = u.dealId ? dealName.get(u.dealId) : null;
      parts.push(`- ${u.scheduledAt ? u.scheduledAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : ""} · ${u.title}${deal ? ` · deal: ${deal}` : ""}`);
    }
  }

  if (openTasks.length) {
    parts.push("\nOpen tasks:");
    for (const t of openTasks) {
      const deal = t.dealId ? dealName.get(t.dealId) : null;
      parts.push(`- ${t.text}${t.ownerLabel ? ` (owner: ${t.ownerLabel})` : ""}${deal ? ` · deal: ${deal}` : ""} · added ${day(t.createdAt)}`);
    }
  }

  if (people.length) {
    parts.push("\nPeople this user has met:");
    for (const c of people) {
      const bits = [c.role, c.company].filter(Boolean).join(", ");
      const last = c.lastMeetingAt ? `last met ${day(c.lastMeetingAt)}` : "";
      parts.push(`- ${c.name}${bits ? ` (${bits})` : ""}; ${c.meetingCount} meetings${last ? `, ${last}` : ""}${c.relationshipSummary ? ` — ${clip(c.relationshipSummary, 200)}` : ""}`);
    }
  }

  return parts.join("\n");
}

// One meeting's recap page: its summary, people and transcript, plus the
// deal it belongs to. Null when this user can't see the meeting.
export async function buildMeetingContext(
  userId: string,
  meetingId: string
): Promise<{ context: string; title: string } | null> {
  const access = await authorizeMeeting(userId, meetingId);
  if (!access) return null;
  const { meeting, deal } = access;

  const [[summary], [transcript], people] = await Promise.all([
    db.select().from(summaries).where(eq(summaries.meetingId, meetingId)),
    db.select().from(transcripts).where(eq(transcripts.meetingId, meetingId)),
    db
      .select({ speakerLabel: meetingParticipants.speakerLabel, displayName: meetingParticipants.displayName })
      .from(meetingParticipants)
      .where(eq(meetingParticipants.meetingId, meetingId)),
  ]);

  const nameByLabel = new Map(people.map((p) => [p.speakerLabel, p.displayName || p.speakerLabel]));
  const parts: string[] = [];
  parts.push(`Today is ${day(new Date())}.`);
  parts.push(`Meeting: "${meeting.title}" on ${day(meeting.occurredAt)}${deal ? ` · deal: ${deal.name} (stage ${deal.stage})` : ""}.`);
  if (people.length) parts.push(`People in the call: ${[...new Set(nameByLabel.values())].join(", ")}.`);
  if (deal?.memory) parts.push(`\nWhat Anchor remembers about this deal: ${clip(deal.memory, 1200)}`);
  if (summary) {
    parts.push(`\nSummary: ${summary.overview}`);
    if (summary.keyPoints?.length) parts.push(`Key points:\n${summary.keyPoints.map((k) => `- ${k}`).join("\n")}`);
    if (summary.actionItems?.length) {
      parts.push(`Action items:\n${summary.actionItems.map((a) => `- ${a.text}${a.owner ? ` (${a.owner})` : ""}`).join("\n")}`);
    }
    if (summary.dealSignals?.length) {
      parts.push(`Deal signals:\n${summary.dealSignals.map((s) => `- ${s.type.replace("_", " ")}: ${s.detail}`).join("\n")}`);
    }
  } else {
    parts.push(`\nThis meeting hasn't finished processing yet (status: ${meeting.status}).`);
  }
  if (transcript) {
    const text = transcript.utterances?.length
      ? transcript.utterances
          .map((u) => {
            const mins = Math.floor(u.startMs / 60000);
            const secs = Math.floor((u.startMs % 60000) / 1000);
            return `[${mins}:${String(secs).padStart(2, "0")}] ${nameByLabel.get(u.speakerLabel) ?? u.speakerLabel}: ${u.text}`;
          })
          .join("\n")
      : transcript.fullText;
    const clipped = text.length > MAX_TRANSCRIPT_CHARS;
    parts.push(`\nTranscript${clipped ? " (first part only — it's long)" : ""}:\n${clipped ? text.slice(0, MAX_TRANSCRIPT_CHARS) : text}`);
  }
  return { context: parts.join("\n"), title: meeting.title };
}
