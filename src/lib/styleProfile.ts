import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { deals, dealMessages, userStyleProfiles } from "@/db/schema";

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
  return new Anthropic({ apiKey });
}

// Below this many source items, there simply isn't enough of this
// person's own material to say anything real about how they operate —
// leave the profile null rather than have the model pad out three
// sentences from almost nothing.
const MIN_SOURCE_ITEMS = 3;
const MAX_DEALS = 25;
const MAX_MESSAGES = 40;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isStyleProfileStale(updatedAt: Date | null | undefined): boolean {
  if (!updatedAt) return true;
  return Date.now() - updatedAt.getTime() > STALE_AFTER_MS;
}

async function gatherSourceMaterial(userId: string) {
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

  const sourceCount = dealRows.length + messageRows.length;
  return { dealRows, messageRows, sourceCount };
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
          "3-5 sentences, written in third person, describing how this specific person tends to negotiate, what they hold firm on vs. stay flexible on, how they make decisions, and their communication tone — grounded ONLY in the material given. Never invent a trait or preference that isn't evidenced. If the material is thin, say less rather than generalize.",
      },
    },
    required: ["profile"],
  },
};

// Builds (or rebuilds) one person's style profile from their own material
// — never from what other people said about them, and never from a
// meeting transcript, since Anchor doesn't yet reliably know which
// speaker label in a transcript is this specific internal person rather
// than someone external on the call. Deal notes, decision boundaries, and
// deal-chat messages are all things this exact person typed themselves,
// which makes them a clean (if narrower) signal to start from.
export async function buildStyleProfile(
  userId: string
): Promise<{ profile: string | null; sourceCount: number }> {
  const { dealRows, messageRows, sourceCount } = await gatherSourceMaterial(userId);

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

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 400,
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
