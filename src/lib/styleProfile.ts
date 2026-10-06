import Anthropic from "@anthropic-ai/sdk";
import { meteredFetch } from "./aiUsage";
import { createWithForcedTool } from "./forcedTool";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { deals, dealMessages, meetingParticipants, meetings, summaries, transcripts, userStyleProfiles, users } from "@/db/schema";

// Same model as the other batch/quality-sensitive features (summarize,
// handoff briefing) — this only ever runs in the background or on an
// explicit "generate a briefing" click, never in the live-assist hot
// path itself, so quality matters more than shaving off latency here.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and add it to .env.local"
    );
  }
  return new Anthropic({ apiKey, fetch: meteredFetch("style_profile") });
}

// Below this many source items, there simply isn't enough of this
// person's own material to say anything real about how they operate —
// leave the profile null rather than have the model pad out three
// sentences from almost nothing.
const MIN_SOURCE_ITEMS = 3;
const MAX_DEALS = 25;
const MAX_MESSAGES = 40;
const MAX_CALLS = 15;
const MAX_SPOKEN_LINES = 60;
const MAX_COMMITMENTS = 30;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isStyleProfileStale(updatedAt: Date | null | undefined): boolean {
  if (!updatedAt) return true;
  return Date.now() - updatedAt.getTime() > STALE_AFTER_MS;
}

async function gatherSourceMaterial(userId: string) {
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  const myName = me?.name?.trim() || null;

  const dealRows = await db
    .select({ name: deals.name, notes: deals.notes, decisionBoundaries: deals.decisionBoundaries })
    .from(deals)
    .where(
      and(eq(deals.leadUserId, userId), or(isNotNull(deals.notes), isNotNull(deals.decisionBoundaries)))
    )
    .orderBy(desc(deals.updatedAt))
    .limit(MAX_DEALS);

  const messageRows = await db
    .select({ content: dealMessages.content })
    .from(dealMessages)
    .where(eq(dealMessages.userId, userId))
    .orderBy(desc(dealMessages.createdAt))
    .limit(MAX_MESSAGES);

  // Their own words on calls: only lines from a speaker whose resolved name
  // is exactly this person's full name (speaker names are matched or fixed
  // by hand on the meeting page), never a guess from a bare "Speaker A".
  // And what they took on themselves: action items assigned to them.
  const spokenLines: string[] = [];
  const commitments: string[] = [];
  if (myName && myName.includes(" ")) {
    const calls = await db
      .select({ id: meetings.id, title: meetings.title, utterances: transcripts.utterances, actionItems: summaries.actionItems })
      .from(meetings)
      .innerJoin(transcripts, eq(transcripts.meetingId, meetings.id))
      .leftJoin(summaries, eq(summaries.meetingId, meetings.id))
      .leftJoin(deals, eq(deals.id, meetings.dealId))
      .where(or(eq(meetings.userId, userId), eq(deals.leadUserId, userId)))
      .orderBy(desc(meetings.occurredAt))
      .limit(MAX_CALLS);
    const speakers = calls.length
      ? await db
          .select({ meetingId: meetingParticipants.meetingId, speakerLabel: meetingParticipants.speakerLabel, displayName: meetingParticipants.displayName })
          .from(meetingParticipants)
          .where(inArray(meetingParticipants.meetingId, calls.map((c) => c.id)))
      : [];
    const target = myName.toLowerCase();
    const mine = new Set(
      speakers.filter((s) => s.displayName?.replace(/\s*\(you\)\s*$/i, "").trim().toLowerCase() === target).map((s) => `${s.meetingId}:${s.speakerLabel}`)
    );
    for (const c of calls) {
      for (const u of c.utterances ?? []) {
        if (spokenLines.length >= MAX_SPOKEN_LINES) break;
        if (mine.has(`${c.id}:${u.speakerLabel}`) && u.text.length >= 40) spokenLines.push(`(${c.title}) ${u.text}`);
      }
      for (const a of c.actionItems ?? []) {
        if (commitments.length >= MAX_COMMITMENTS) break;
        if (a.owner?.trim().toLowerCase() === target) commitments.push(`(${c.title}) ${a.text}`);
      }
    }
  }

  const sourceCount = dealRows.length + messageRows.length + Math.ceil(spokenLines.length / 5) + Math.ceil(commitments.length / 3);
  return { dealRows, messageRows, spokenLines, commitments, sourceCount };
}

const STYLE_TOOL = {
  name: "record_style_profile",
  description: "Record a profile of how this specific person negotiates, decides, and communicates.",
  input_schema: {
    type: "object" as const,
    properties: {
      profile: {
        type: "string",
        description:
          "3-6 sentences, written in third person, describing how this specific person tends to negotiate, what they hold firm on vs. stay flexible on, how they make decisions, how they typically handle common moments (price pushback, delays, a new stakeholder, an objection), and their communication tone — grounded ONLY in the material given. Never invent a trait or preference that isn't evidenced. If the material is thin, say less rather than generalize.",
      },
    },
    required: ["profile"],
  },
};

// Builds (or rebuilds) one person's style profile from their own material
// — never from what other people said about them: deal notes, decision
// boundaries and deal-chat messages they typed, the lines they said on
// calls (only where the speaker is named as them — see
// gatherSourceMaterial), and the action items they took on.
export async function buildStyleProfile(
  userId: string
): Promise<{ profile: string | null; sourceCount: number }> {
  const { dealRows, messageRows, spokenLines, commitments, sourceCount } = await gatherSourceMaterial(userId);

  if (sourceCount < MIN_SOURCE_ITEMS) {
    return { profile: null, sourceCount };
  }

  const dealsBlock = dealRows
    .map((d) => {
      const lines = [`— ${d.name}`];
      if (d.decisionBoundaries) lines.push(`Decision boundaries they set: ${d.decisionBoundaries}`);
      if (d.notes) lines.push(`Their own notes: ${d.notes}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const messagesBlock = messageRows.map((m) => `— ${m.content}`).join("\n");

  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 600,
    system:
      "You study a salesperson's own written material — never what other people said about them — to describe how they operate. Be specific and grounded only in what's given. Never invent a trait, preference, or habit that isn't evidenced in the material.",
    tools: [STYLE_TOOL],
    tool_choice: { type: "tool", name: STYLE_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Decision boundaries and notes this person has written on deals they lead:\n${
          dealsBlock || "None."
        }\n\nMessages this person has sent in deal chat:\n${
          messagesBlock || "None."
        }\n\nThings this person said on their own calls:\n${
          spokenLines.map((l) => `— ${l}`).join("\n") || "None."
        }\n\nAction items this person took on after calls:\n${
          commitments.map((l) => `— ${l}`).join("\n") || "None."
        }\n\nDescribe how this specific person negotiates, decides, and communicates.`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return { profile: null, sourceCount };
  }

  const raw = toolUse.input as { profile?: unknown };
  const profile = typeof raw.profile === "string" ? raw.profile : null;
  return { profile, sourceCount };
}

async function persistStyleProfile(userId: string, built: { profile: string | null; sourceCount: number }) {
  await db
    .insert(userStyleProfiles)
    .values({ userId, profile: built.profile, sourceCount: built.sourceCount, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userStyleProfiles.userId,
      set: { profile: built.profile, sourceCount: built.sourceCount, updatedAt: new Date() },
    });
}

// The one function the rest of the app should call. Returns the deal
// lead's style profile text (or null — either no lead is set, or there
// isn't enough of their own material yet to say anything real).
//
// `allowSynchronousRebuild` controls what happens when the stored profile
// is stale: a handoff briefing is generated on an explicit click, so it's
// fine to wait the extra second and rebuild first. Live Assist answers a
// question mid-meeting, where that same second matters — there it returns
// the existing (possibly a day old) profile immediately and kicks off a
// rebuild in the background for next time, rather than making someone
// wait on it. A profile that's never been built at all is always built
// synchronously either way — there's nothing to fall back to yet.
export async function getDealLeadStyle(
  leadUserId: string | null,
  opts?: { allowSynchronousRebuild?: boolean }
): Promise<string | null> {
  if (!leadUserId) return null;

  try {
    const [existing] = await db
      .select()
      .from(userStyleProfiles)
      .where(eq(userStyleProfiles.userId, leadUserId));

    if (!existing) {
      const built = await buildStyleProfile(leadUserId);
      await persistStyleProfile(leadUserId, built);
      return built.profile;
    }

    if (isStyleProfileStale(existing.updatedAt)) {
      if (opts?.allowSynchronousRebuild) {
        const built = await buildStyleProfile(leadUserId);
        await persistStyleProfile(leadUserId, built);
        return built.profile;
      }
      // Fire-and-forget refresh — never let this add latency to a live
      // answer. Errors here are logged, not surfaced; the stale profile
      // (if any) already returned below is still a reasonable answer.
      buildStyleProfile(leadUserId)
        .then((built) => persistStyleProfile(leadUserId, built))
        .catch((err) => console.error(`[styleProfile] background refresh failed for ${leadUserId}:`, err));
    }

    return existing.profile;
  } catch (err) {
    console.error(`[styleProfile] getDealLeadStyle failed for ${leadUserId}:`, err);
    return null;
  }
}
