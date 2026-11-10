import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { contacts, deals, meetings, summaries } from "@/db/schema";
import { MAIN_MODEL } from "@/lib/aiModels";
import { meteredFetch, withAiUser } from "@/lib/aiUsage";
import { logDataChange } from "@/lib/dataChangeLog";
import { createWithForcedTool } from "@/lib/forcedTool";
import { attachMeetingToDeal } from "@/lib/processMeeting";
import { getOrCreateTeamId } from "@/lib/team";

// Rebuilds deals that were lost (permanently deleted before the deal trash
// existed) from the calls that were on them. Calls survive a deal's
// deletion with their transcripts and summaries, only unlinked; this reads
// a person's unlinked calls and their contacts, works out which company or
// deal each call was about, and recreates those deals on their team with
// the calls attached, which rebuilds the deal memory, tasks and reports
// (attachMeetingToDeal).
//
// Preview first (apply = false) returns the plan without changing anything.

export type RebuildPlan = {
  deals: { name: string; company: string; existingDealId: string | null; meetingIds: string[]; meetingTitles: string[] }[];
  skipped: { meetingId: string; title: string; reason: string }[];
};

const PLAN_TOOL: Anthropic.Tool = {
  name: "record_deal_groups",
  description: "Group a person's calls by the client deal each one was about.",
  input_schema: {
    type: "object",
    properties: {
      deals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short deal name, e.g. 'Hotel Lisbon refinancing' or the counterparty's company name." },
            company: { type: "string", description: "The client or counterparty company." },
            existing_deal_id: { type: "string", description: "Id of one of the EXISTING deals if these calls belong to it, else empty." },
            meeting_ids: { type: "array", items: { type: "string" } },
          },
          required: ["name", "company", "meeting_ids"],
        },
      },
      skipped: {
        type: "array",
        description: "Calls that weren't about a client deal (internal, test, too short to tell).",
        items: {
          type: "object",
          properties: { meeting_id: { type: "string" }, reason: { type: "string" } },
          required: ["meeting_id", "reason"],
        },
      },
    },
    required: ["deals", "skipped"],
  },
};

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  return new Anthropic({ apiKey, fetch: meteredFetch("rebuild_deals") });
}

export async function planRebuild(userId: string): Promise<RebuildPlan> {
  const teamId = await getOrCreateTeamId(userId);
  const calls = await db
    .select({ id: meetings.id, title: meetings.title, occurredAt: meetings.occurredAt, createdAt: meetings.createdAt, summary: summaries })
    .from(meetings)
    .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
    .where(and(eq(meetings.userId, userId), isNull(meetings.dealId), eq(meetings.status, "ready")))
    .orderBy(desc(meetings.createdAt));
  if (calls.length === 0) return { deals: [], skipped: [] };

  const [existing, people] = await Promise.all([
    db.select({ id: deals.id, name: deals.name }).from(deals).where(eq(deals.teamId, teamId)),
    db.select({ name: contacts.name, company: contacts.company, role: contacts.role }).from(contacts).where(eq(contacts.userId, userId)).limit(200),
  ]);

  const callText = calls
    .map((c) => {
      const s = c.summary;
      return [
        `### Call ${c.id}`,
        `Title: ${c.title ?? "(untitled)"}  Date: ${(c.occurredAt ?? c.createdAt).toISOString().slice(0, 10)}`,
        `Overview: ${s.overview}`,
        `Key points: ${(s.keyPoints ?? []).slice(0, 8).join(" | ")}`,
      ].join("\n");
    })
    .join("\n\n");
  const prompt = [
    `EXISTING deals on the team:\n${existing.map((d) => `- ${d.id}: ${d.name}`).join("\n") || "(none)"}`,
    `The person's contacts:\n${people.map((p) => `- ${p.name}${p.role ? `, ${p.role}` : ""}${p.company ? ` at ${p.company}` : ""}`).join("\n") || "(none)"}`,
    `Calls that aren't on any deal:\n\n${callText}`,
    "Group every call by the client deal it was about. Put calls about the same counterparty, property or transaction in one deal. Use an existing deal when the calls clearly belong to it. Every call id must appear exactly once, in a deal or in skipped.",
  ].join("\n\n");

  const message = await withAiUser({ userId }, () =>
    createWithForcedTool(client(), {
      model: MAIN_MODEL,
      max_tokens: 4096,
      system: "You organise a dealmaker's recorded client calls into deals. Be conservative: only group calls you're confident are about the same deal.",
      tools: [PLAN_TOOL],
      tool_choice: { type: "tool", name: PLAN_TOOL.name },
      messages: [{ role: "user", content: prompt }],
    })
  );
  const block = message.content.find((b) => b.type === "tool_use");
  const input = (block && block.type === "tool_use" ? block.input : {}) as {
    deals?: { name?: string; company?: string; existing_deal_id?: string; meeting_ids?: string[] }[];
    skipped?: { meeting_id?: string; reason?: string }[];
  };

  const known = new Map(calls.map((c) => [c.id, c.title ?? "(untitled)"]));
  const existingIds = new Set(existing.map((d) => d.id));
  const used = new Set<string>();
  const plan: RebuildPlan = { deals: [], skipped: [] };
  for (const d of input.deals ?? []) {
    const ids = (d.meeting_ids ?? []).filter((id) => known.has(id) && !used.has(id));
    if (ids.length === 0 || !d.name?.trim()) continue;
    ids.forEach((id) => used.add(id));
    plan.deals.push({
      name: d.name.trim().slice(0, 120),
      company: (d.company ?? "").trim().slice(0, 120),
      existingDealId: d.existing_deal_id && existingIds.has(d.existing_deal_id) ? d.existing_deal_id : null,
      meetingIds: ids,
      meetingTitles: ids.map((id) => known.get(id)!),
    });
  }
  for (const s of input.skipped ?? []) {
    if (s.meeting_id && known.has(s.meeting_id) && !used.has(s.meeting_id)) {
      used.add(s.meeting_id);
      plan.skipped.push({ meetingId: s.meeting_id, title: known.get(s.meeting_id)!, reason: (s.reason ?? "").slice(0, 200) });
    }
  }
  for (const [id, title] of known) {
    if (!used.has(id)) plan.skipped.push({ meetingId: id, title, reason: "not grouped" });
  }
  return plan;
}

// Creates the planned deals (lead: the person) and attaches the calls.
// Re-checks that each call is still unlinked, so running it twice can't
// double anything.
export async function applyRebuild(userId: string, plan: RebuildPlan): Promise<{ created: number; attached: number }> {
  const teamId = await getOrCreateTeamId(userId);
  let created = 0;
  let attached = 0;
  for (const d of plan.deals) {
    const free = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(and(inArray(meetings.id, d.meetingIds), eq(meetings.userId, userId), isNull(meetings.dealId)));
    if (free.length === 0) continue;
    let dealId = d.existingDealId;
    if (!dealId) {
      const [deal] = await db
        .insert(deals)
        .values({ teamId, name: d.name, createdByUserId: userId, leadUserId: userId })
        .returning({ id: deals.id });
      dealId = deal.id;
      created++;
    }
    for (const m of free) {
      await db.update(meetings).set({ dealId }).where(and(eq(meetings.id, m.id), isNull(meetings.dealId)));
      await attachMeetingToDeal(m.id, dealId);
      attached++;
    }
  }
  await logDataChange({
    action: "deals_rebuilt",
    teamId,
    targetId: userId,
    details: { created, attached, deals: plan.deals.map((d) => d.name) },
  });
  return { created, attached };
}
