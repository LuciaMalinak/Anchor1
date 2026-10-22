import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { meetingProposals, morningBriefs } from "@/db/schema";
import { meteredFetch, withAiUser } from "./aiUsage";
import { createWithForcedTool } from "./forcedTool";
import { getConnection } from "./integrations/oauthConnection";
import { DEFAULT_PREFS, normalizePrefs } from "./morningBriefPrefs";

// Notices in someone's Slack direct messages when a meeting should be set
// up ("can we find 30 min next week?", "let's get the three of us on a
// call"), and keeps it as a meeting proposal they can set up from Anchor
// in one go (meetingScheduler.ts). Email requests come from the Morning
// brief. Reads only the person's own DMs and group DMs, with their own
// Slack user token (?add=read_dms on the Slack connection).

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const LOOKBACK_SECONDS = 2 * 86_400;
const MAX_CONVERSATIONS = 25;
const MAX_MESSAGES = 20;

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  return new Anthropic({ apiKey, fetch: meteredFetch("meeting_detection") });
}

async function slackGet(token: string, method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!json.ok) throw new Error(`Slack ${method} failed: ${String(json.error ?? res.status)}`);
  return json;
}

type Person = { name: string; email: string | null };

type Conversation = {
  channel: string;
  latestTs: string;
  participants: Person[];
  lines: string[];
};

async function readRecentDms(token: string): Promise<{ me: string; conversations: Conversation[] }> {
  const who = await slackGet(token, "auth.test", {});
  const me = String(who.user_id ?? "");
  const list = await slackGet(token, "conversations.list", { types: "im,mpim", limit: "200", exclude_archived: "true" });
  const channels = ((list.channels as { id: string }[]) ?? []).slice(0, 200);
  const oldest = String(Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS);

  const people = new Map<string, Person>();
  const person = async (id: string): Promise<Person> => {
    const known = people.get(id);
    if (known) return known;
    let p: Person = { name: id, email: null };
    try {
      const info = await slackGet(token, "users.info", { user: id });
      const u = info.user as { real_name?: string; name?: string; is_bot?: boolean; profile?: { email?: string; real_name?: string } };
      p = { name: u.profile?.real_name || u.real_name || u.name || id, email: u.profile?.email ?? null };
    } catch {
      // Name stays the id; no email means they can't be invited.
    }
    people.set(id, p);
    return p;
  };

  const conversations: Conversation[] = [];
  for (const c of channels) {
    if (conversations.length >= MAX_CONVERSATIONS) break;
    let history: Record<string, unknown>;
    try {
      history = await slackGet(token, "conversations.history", { channel: c.id, oldest, limit: String(MAX_MESSAGES) });
    } catch {
      continue;
    }
    const messages = ((history.messages as { user?: string; text?: string; ts: string; subtype?: string }[]) ?? []).filter(
      (m) => m.user && m.text && !m.subtype
    );
    if (!messages.length) continue;
    // Only conversations where someone else spoke recently.
    if (!messages.some((m) => m.user !== me)) continue;
    const ordered = messages.slice().reverse();
    const ids = [...new Set(ordered.map((m) => m.user!))];
    const named = await Promise.all(ids.map(async (id) => [id, await person(id)] as const));
    const byId = new Map(named);
    conversations.push({
      channel: c.id,
      latestTs: messages[0].ts,
      participants: named.filter(([id]) => id !== me).map(([, p]) => p),
      lines: ordered.map((m) => `${m.user === me ? "Me" : byId.get(m.user!)?.name ?? "Someone"}: ${m.text!.slice(0, 500)}`),
    });
  }
  return { me, conversations };
}

const DETECT_TOOL: Anthropic.Tool = {
  name: "record_meeting_requests",
  description: "Record which conversations call for setting up a meeting.",
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            needsMeeting: {
              type: "boolean",
              description:
                "True only when someone asked to meet, proposed a call, or agreed to one that still needs to be set up, and the person (\"Me\") would be the one to send the invite. Not for meetings already scheduled, or for chit-chat.",
            },
            title: { type: "string", description: "Short meeting title, e.g. 'Pricing review with Dana'." },
            reason: { type: "string", description: "One line quoting or paraphrasing the ask." },
            start: {
              type: ["string", "null"],
              description: "The proposed start as local time 'YYYY-MM-DDTHH:MM' when a specific day and time was agreed or proposed; otherwise null.",
            },
            durationMinutes: { type: "integer", description: "Proposed length; 30 if not said." },
          },
          required: ["id", "needsMeeting", "title", "reason", "start", "durationMinutes"],
        },
      },
    },
    required: ["results"],
  },
};

export async function scanSlackForMeetings(userId: string): Promise<number> {
  const slack = await getConnection(userId, "slack");
  const token = slack?.userAccessToken;
  if (!token) return 0;

  const { conversations } = await readRecentDms(token);
  if (!conversations.length) return 0;

  // Skip conversations already read up to their latest message.
  const keys = conversations.map((c) => `${c.channel}:${c.latestTs}`);
  const seen = new Set(
    (
      await db
        .select({ sourceKey: meetingProposals.sourceKey })
        .from(meetingProposals)
        .where(and(eq(meetingProposals.userId, userId), eq(meetingProposals.source, "slack"), inArray(meetingProposals.sourceKey, keys)))
    ).map((r) => r.sourceKey)
  );
  const fresh = conversations.filter((c) => !seen.has(`${c.channel}:${c.latestTs}`));
  if (!fresh.length) return 0;

  const [brief] = await db.select({ prefs: morningBriefs.prefs }).from(morningBriefs).where(eq(morningBriefs.userId, userId));
  const timeZone = brief ? normalizePrefs(brief.prefs).timeZone : DEFAULT_PREFS.timeZone;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const message = await withAiUser({ userId }, () =>
    createWithForcedTool(client(), {
      model: MODEL,
      max_tokens: 4000,
      system: `You read someone's recent Slack direct messages and spot the ones where a meeting should now be set up, with them ("Me") sending the invite. Today is ${today} (${timeZone}). Be strict: only real requests or agreements to meet that aren't already scheduled.`,
      tools: [DETECT_TOOL],
      tool_choice: { type: "tool", name: DETECT_TOOL.name },
      messages: [
        {
          role: "user",
          content: fresh
            .map((c, i) => `### Conversation ${i} with ${c.participants.map((p) => p.name).join(", ") || "someone"}\n${c.lines.join("\n")}`)
            .join("\n\n"),
        },
      ],
    })
  );
  const toolUse = message.content.find((b) => b.type === "tool_use");
  const results = toolUse && toolUse.type === "tool_use" ? ((toolUse.input as { results?: unknown }).results as unknown[]) ?? [] : [];
  const byId = new Map<number, Record<string, unknown>>();
  for (const r of results) if (r && typeof r === "object") byId.set(Number((r as { id: unknown }).id), r as Record<string, unknown>);

  let found = 0;
  for (const [i, c] of fresh.entries()) {
    const r = byId.get(i);
    const needs = r?.needsMeeting === true;
    const start = typeof r?.start === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.start) ? r.start : null;
    const duration = Math.min(240, Math.max(15, Number(r?.durationMinutes) || 30));
    await db
      .insert(meetingProposals)
      .values({
        userId,
        source: "slack",
        sourceKey: `${c.channel}:${c.latestTs}`,
        sourceUrl: `https://slack.com/app_redirect?channel=${c.channel}`,
        fromName: c.participants.map((p) => p.name).join(", ") || "Slack",
        title: needs && typeof r?.title === "string" ? r.title.slice(0, 120) : "",
        reason: needs && typeof r?.reason === "string" ? r.reason.slice(0, 300) : "",
        start: needs ? start : null,
        durationMinutes: duration,
        timeZone,
        attendees: c.participants.filter((p) => p.email).map((p) => ({ name: p.name, email: p.email! })),
        status: needs ? "open" : "none",
      })
      .onConflictDoNothing();
    if (needs) found++;
  }
  return found;
}

// Everyone who let Anchor read their Slack DMs. Run hourly with reply
// drafting (morningBrief.ts).
export async function scanSlackForEveryone(userIds: string[]): Promise<number> {
  let found = 0;
  for (const userId of userIds) {
    try {
      found += await scanSlackForMeetings(userId);
    } catch (err) {
      console.error(`[meetingProposals] Slack scan failed for ${userId}:`, err);
    }
  }
  return found;
}
