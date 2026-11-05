import { and, desc, eq, gte, inArray, lt, lte, ne, or, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { linkedinBot, linkedinBotItems } from "@/db/schema";
import { localDateISO } from "@/lib/timeZone";
import { normalizeSettings, weekday, zonedTime, type LinkedInBotSettings } from "./settings";
import { createPost, LinkedInError, refreshAccessToken, uploadVideo } from "./api";
import { draftComments, findPostsToComment, pickEngagementTargets, researchNotes, writePosts, writeVideo, type Slide } from "./write";
import { renderSlideVideo } from "./video";
import { mediaUrl } from "./media";

// The LinkedIn bot's daily loop, run every few minutes by the server
// (instrumentation.ts) and by /api/cron/linkedin-bot:
//  1. Once a day (the Page's local date), write the day's posts, the
//     weekly video on its day, and today's companies to engage with.
//  2. Publish every post or video whose time has come.
// Comments on other companies' posts are only ever drafted: LinkedIn
// doesn't allow automated commenting, so those are posted by hand.

export type BotRow = typeof linkedinBot.$inferSelect;
export type BotItem = typeof linkedinBotItems.$inferSelect;

const BOT_ID = "main";
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 15 * 60_000;
// A time slot that passed this long ago when the day is planned is moved
// later in the day instead.
const LATE_SLOT_MS = 30 * 60_000;
const LAST_POST_HOUR = 21;
const COMMENTS_PER_DAY = 3;

export async function loadBot(): Promise<BotRow> {
  const [row] = await db.select().from(linkedinBot).where(eq(linkedinBot.id, BOT_ID));
  if (row) return row;
  await db.insert(linkedinBot).values({ id: BOT_ID }).onConflictDoNothing();
  const [created] = await db.select().from(linkedinBot).where(eq(linkedinBot.id, BOT_ID));
  return created;
}

export async function updateBot(values: Partial<typeof linkedinBot.$inferInsert>): Promise<void> {
  await db.update(linkedinBot).set({ ...values, updatedAt: new Date() }).where(eq(linkedinBot.id, BOT_ID));
}

// A working access token, refreshed first if it's about to run out.
async function accessToken(bot: BotRow): Promise<string> {
  if (!bot.accessToken) throw new Error("The LinkedIn Page isn't connected");
  const soon = Date.now() + 5 * 24 * 3600_000;
  if (bot.tokenExpiresAt && bot.tokenExpiresAt.getTime() < soon && bot.refreshToken) {
    const t = await refreshAccessToken(bot.refreshToken);
    await updateBot({
      accessToken: t.accessToken,
      refreshToken: t.refreshToken ?? bot.refreshToken,
      tokenExpiresAt: t.tokenExpiresAt,
      refreshExpiresAt: t.refreshExpiresAt ?? bot.refreshExpiresAt,
    });
    return t.accessToken;
  }
  if (bot.tokenExpiresAt && bot.tokenExpiresAt.getTime() < Date.now()) {
    throw new Error("The LinkedIn connection has expired. Reconnect the Page on the LinkedIn bot page.");
  }
  return bot.accessToken;
}

function todayLabel(timeZone: string): string {
  return new Date().toLocaleDateString("en-US", { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

async function recentTexts(): Promise<string[]> {
  const rows = await db
    .select({ text: linkedinBotItems.text })
    .from(linkedinBotItems)
    .where(inArray(linkedinBotItems.kind, ["post", "video"]))
    .orderBy(desc(linkedinBotItems.createdAt))
    .limit(15);
  return rows.map((r) => r.text.split("\n").find((l) => l.trim())?.slice(0, 140) ?? "").filter(Boolean);
}

// When each of today's slots should go out: as set, or (if the day is
// planned after a slot has passed) later today, spaced out.
function slotTimes(settings: LinkedInBotSettings, dateISO: string, times: string[]): Date[] {
  const now = Date.now();
  const latest = zonedTime(dateISO, `${LAST_POST_HOUR}:00`, settings.timeZone).getTime();
  const out: Date[] = [];
  let next = now + 15 * 60_000;
  for (const t of times) {
    let at = zonedTime(dateISO, t, settings.timeZone).getTime();
    if (at < now - LATE_SLOT_MS) {
      at = next;
      next += 3 * 3600_000;
      if (at > latest) continue;
    } else if (at < now) {
      at = now + 60_000;
    }
    out.push(new Date(at));
  }
  return out;
}

// Writes the day's posts (and the video on video day) and today's
// engagement list. With replace, today's not-yet-posted items are thrown
// away and written again ("Write today's posts again").
export async function planDay(opts: { replace?: boolean } = {}): Promise<{ posts: number; video: boolean }> {
  const bot = await loadBot();
  const settings = normalizeSettings(bot.settings);
  const dateISO = localDateISO(new Date(), settings.timeZone);
  const label = todayLabel(settings.timeZone);

  if (opts.replace) {
    const dayStart = zonedTime(dateISO, "00:00", settings.timeZone);
    await db
      .update(linkedinBotItems)
      .set({ status: "skipped", error: "Replaced by a new draft" })
      .where(
        and(
          inArray(linkedinBotItems.kind, ["post", "video"]),
          eq(linkedinBotItems.status, "scheduled"),
          gte(linkedinBotItems.scheduledFor, dayStart),
        ),
      );
  }

  const [notes, recent] = await Promise.all([researchNotes(settings, label), recentTexts()]);

  const postSlots = slotTimes(settings, dateISO, settings.postTimes);
  let posts = 0;
  if (postSlots.length) {
    const drafts = await writePosts({ settings, count: postSlots.length, recent, notes, todayLabel: label });
    const rows = drafts.slice(0, postSlots.length).map((d, i) => ({
      kind: "post",
      status: "scheduled",
      scheduledFor: postSlots[i],
      topic: d.topic,
      text: d.text.trim(),
    }));
    if (rows.length) await db.insert(linkedinBotItems).values(rows);
    posts = rows.length;
  }

  let video = false;
  if (weekday(dateISO) === settings.videoDay) {
    const [slot] = slotTimes(settings, dateISO, [settings.videoTime]);
    if (slot) {
      const v = await writeVideo({ settings, recent, notes, todayLabel: label });
      await db.insert(linkedinBotItems).values({
        kind: "video",
        status: "scheduled",
        scheduledFor: slot,
        topic: v.topic,
        text: v.caption.trim(),
        extra: { title: v.title, slides: v.slides },
      });
      video = true;
    }
  }

  try {
    const targets = await pickEngagementTargets(settings, notes);
    await updateBot({ engagement: { date: dateISO, targets } });
  } catch (err) {
    console.error("[linkedinBot] engagement list failed:", err);
  }

  // Today's posts in the space to comment on, ready to copy and post.
  // Yesterday's unused ones are old news by now, so they're cleared.
  try {
    await db
      .update(linkedinBotItems)
      .set({ status: "skipped" })
      .where(
        and(
          eq(linkedinBotItems.kind, "comment"),
          eq(linkedinBotItems.status, "draft"),
          sql`${linkedinBotItems.createdAt} < now() - interval '36 hours'`,
        ),
      );
    const recentComments = await db
      .select({ extra: linkedinBotItems.extra })
      .from(linkedinBotItems)
      .where(and(eq(linkedinBotItems.kind, "comment"), sql`${linkedinBotItems.createdAt} > now() - interval '60 days'`));
    const skip = recentComments.map((r) => String((r.extra as { url?: string } | null)?.url ?? "")).filter(Boolean);
    const picks = await findPostsToComment(settings, COMMENTS_PER_DAY, skip);
    if (picks.length) {
      await db.insert(linkedinBotItems).values(
        picks.map((p) => ({
          kind: "comment",
          status: "draft",
          topic: p.author || null,
          text: p.comments[0],
          extra: { options: p.comments, url: p.url, author: p.author, postText: p.postText, daily: true },
        })),
      );
    }
  } catch (err) {
    console.error("[linkedinBot] finding posts to comment on failed:", err);
  }

  await updateBot({ lastPlannedOn: dateISO, lastError: null });
  return { posts, video };
}

// Whether the bot has somewhere to post: Zapier, or the Page itself.
export function canPost(bot: BotRow): boolean {
  return Boolean(normalizeSettings(bot.settings).zapierWebhookUrl || (bot.orgUrn && bot.accessToken));
}

// What Zapier receives for each post: flat fields that are easy to map
// in its "LinkedIn → Create Company Update" step.
function zapierPayload(item: Pick<BotItem, "id" | "kind" | "text" | "topic" | "extra" | "scheduledFor">, test = false) {
  const extra = (item.extra ?? {}) as { title?: string };
  const isVideo = item.kind === "video";
  return {
    id: item.id,
    kind: item.kind,
    text: item.text,
    title: isVideo ? extra.title || item.topic || "AI Anchor" : "",
    image_url: isVideo ? (mediaUrl(item.id, "png") ?? "") : "",
    video_url: isVideo ? (mediaUrl(item.id, "mp4") ?? "") : "",
    scheduled_for: item.scheduledFor?.toISOString() ?? "",
    sent_at: new Date().toISOString(),
    test,
  };
}

async function sendToZapier(url: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Zapier didn't accept the post (${res.status})${detail ? `: ${detail}` : ""}`);
  }
}

// A sample sent while setting up the Zap, so Zapier can see the fields.
// Uses the next scheduled post (or a stand-in) and is marked test: true.
export async function sendZapierSample(): Promise<void> {
  const bot = await loadBot();
  const url = normalizeSettings(bot.settings).zapierWebhookUrl;
  if (!url) throw new Error("Add the Zapier webhook link first.");
  const [next] = await db
    .select()
    .from(linkedinBotItems)
    .where(and(inArray(linkedinBotItems.kind, ["post", "video"]), eq(linkedinBotItems.status, "scheduled")))
    .orderBy(linkedinBotItems.scheduledFor)
    .limit(1);
  const sample = next ?? {
    id: "00000000-0000-0000-0000-000000000000",
    kind: "post",
    text: "Test post from Anchor. If you can read this on LinkedIn, the Zap is live.\n\n#AIAnchor",
    topic: null,
    extra: null,
    scheduledFor: new Date(),
  };
  await sendToZapier(url, zapierPayload(sample, true));
}

// Publishes one post or video now. Through Zapier there's no post id to
// keep, so "" is returned.
async function publish(item: BotItem, bot: BotRow): Promise<string> {
  const zapier = normalizeSettings(bot.settings).zapierWebhookUrl;
  if (zapier) {
    await sendToZapier(zapier, zapierPayload(item));
    return "";
  }
  if (!bot.orgUrn) throw new Error("The LinkedIn Page isn't connected");
  const token = await accessToken(bot);
  if (item.kind === "video") {
    const extra = (item.extra ?? {}) as { title?: string; slides?: Slide[] };
    const mp4 = await renderSlideVideo(extra.slides ?? []);
    const videoUrn = await uploadVideo(token, bot.orgUrn, mp4);
    return createPost(token, bot.orgUrn, item.text, { urn: videoUrn, title: extra.title || item.topic || "AI Anchor" });
  }
  return createPost(token, bot.orgUrn, item.text);
}

// Claims a scheduled item (so two runs never post it twice), publishes
// it, and records the outcome. Failures are retried a few times.
export async function postItemNow(id: string): Promise<BotItem | null> {
  const [claimed] = await db
    .update(linkedinBotItems)
    .set({ status: "posting", attempts: sql`${linkedinBotItems.attempts} + 1` })
    .where(and(eq(linkedinBotItems.id, id), inArray(linkedinBotItems.status, ["scheduled", "failed"])))
    .returning();
  if (!claimed) return null;
  const bot = await loadBot();
  try {
    const urn = await publish(claimed, bot);
    const [done] = await db
      .update(linkedinBotItems)
      .set({ status: "posted", linkedinUrn: urn || null, postedAt: new Date(), error: null })
      .where(eq(linkedinBotItems.id, id))
      .returning();
    if (bot.lastError) await updateBot({ lastError: null });
    return done;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[linkedinBot] posting ${id} failed:`, err);
    const authProblem = err instanceof LinkedInError && (err.status === 401 || err.status === 403);
    const giveUp = claimed.attempts >= MAX_ATTEMPTS;
    const [row] = await db
      .update(linkedinBotItems)
      .set({
        status: giveUp ? "failed" : "scheduled",
        error: message,
        scheduledFor: giveUp ? claimed.scheduledFor : new Date(Date.now() + RETRY_AFTER_MS),
      })
      .where(eq(linkedinBotItems.id, id))
      .returning();
    await updateBot({
      lastError: authProblem ? `LinkedIn refused the post (${message}). Reconnect the Page or check the app's access.` : message,
    });
    return row;
  }
}

let running = false;

export async function runLinkedInBot(): Promise<{ skipped?: string; planned?: { posts: number; video: boolean }; posted: number; failed: number }> {
  if (running) return { skipped: "already running", posted: 0, failed: 0 };
  running = true;
  try {
    const bot = await loadBot();
    const settings = normalizeSettings(bot.settings);
    if (!settings.enabled) return { skipped: "off", posted: 0, failed: 0 };
    if (!canPost(bot)) return { skipped: "not connected", posted: 0, failed: 0 };

    // A post left half-way by a restart: don't risk posting it twice.
    await db
      .update(linkedinBotItems)
      .set({ status: "failed", error: "Interrupted while posting. Check the Page before posting it again." })
      .where(and(eq(linkedinBotItems.status, "posting"), lt(linkedinBotItems.scheduledFor, new Date(Date.now() - 30 * 60_000))));

    let planned: { posts: number; video: boolean } | undefined;
    const today = localDateISO(new Date(), settings.timeZone);
    if (bot.lastPlannedOn !== today) {
      // Claim the day first, so two runs at once don't both write posts.
      const [claim] = await db
        .update(linkedinBot)
        .set({ lastPlannedOn: today })
        .where(and(eq(linkedinBot.id, BOT_ID), or(isNull(linkedinBot.lastPlannedOn), ne(linkedinBot.lastPlannedOn, today))))
        .returning();
      if (claim) {
        try {
          planned = await planDay();
        } catch (err) {
          console.error("[linkedinBot] writing today's posts failed:", err);
          // Try again on a later run.
          await updateBot({
            lastPlannedOn: bot.lastPlannedOn,
            lastError: `Couldn't write today's posts: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    const due = await db
      .select({ id: linkedinBotItems.id })
      .from(linkedinBotItems)
      .where(
        and(
          inArray(linkedinBotItems.kind, ["post", "video"]),
          eq(linkedinBotItems.status, "scheduled"),
          lte(linkedinBotItems.scheduledFor, new Date()),
        ),
      )
      .orderBy(linkedinBotItems.scheduledFor)
      .limit(3);
    let posted = 0;
    let failed = 0;
    for (const { id } of due) {
      const row = await postItemNow(id);
      if (row?.status === "posted") posted++;
      else if (row) failed++;
    }
    return { planned, posted, failed };
  } finally {
    running = false;
  }
}

// Three comment options for a post the person pasted in, saved as a draft.
export async function createCommentDraft(input: { postText: string; author: string; url: string }): Promise<BotItem> {
  const bot = await loadBot();
  const settings = normalizeSettings(bot.settings);
  const options = await draftComments(settings, input.postText, input.author);
  if (!options.length) throw new Error("No comments came back. Try again.");
  const [row] = await db
    .insert(linkedinBotItems)
    .values({
      kind: "comment",
      status: "draft",
      topic: input.author || null,
      text: options[0],
      extra: { options, url: input.url, author: input.author, postText: input.postText.slice(0, 600) },
    })
    .returning();
  return row;
}
