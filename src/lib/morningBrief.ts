import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { contacts, deals, meetingParticipants, meetings, morningBriefs, tasks, teams, users } from "@/db/schema";
import { accessibleDealIds, dealVisibilityWhere } from "@/lib/dealAccess";
import { getAttentionItems } from "@/lib/attention";
import { fetchTodaysDealMeetings } from "@/lib/integrations/calendar";
import { fetchMessageText, fetchThreadsAwaitingReply } from "@/lib/integrations/gmailInbox";
import { createGmailDraft } from "@/lib/integrations/gmailDraft";
import { getGoogleConnection } from "@/lib/integrations/google";
import { GOOGLE_EXTRA_SCOPES } from "@/lib/integrations/config";
import { sendEmail } from "@/lib/email";
import { sendSms, isSmsConfigured } from "@/lib/sms";
import { sendSlackDirectMessage, getSlackConnection } from "@/lib/integrations/slack";
import { getDealLeadStyle } from "@/lib/styleProfile";
import { withAiUser } from "@/lib/aiUsage";
import { createBriefToken } from "@/lib/briefLink";
import { draftReply, triageEmails } from "@/lib/morningBriefAi";
import { daysBetween, isBriefDue, localNow, normalizePrefs, type BriefChannel, type MorningBriefPrefs } from "@/lib/morningBriefPrefs";
import {
  briefHeadline,
  isEmptyBrief,
  rankEmails,
  renderBriefHtml,
  renderBriefSlack,
  renderBriefText,
  shouldShowToday,
  type BriefEmail,
  type BriefSnapshot,
  type ShownState,
} from "@/lib/morningBriefRender";

// The Morning brief: each morning, at the time each person chose, a short
// message with the emails still waiting on their reply (summarized by
// AI, and repeated until answered, done or snoozed), their open to-dos,
// today's meetings and deals going quiet — by email, text or Slack. Sent
// by the hourly job (/api/cron/morning-brief) or "Send me one now" on the
// Profile page. Settings and state live in the morning_brief table.

const MAX_EMAILS = 8;
const MAX_TASKS = 5;
const MAX_DRAFTS = 3;

export function siteUrl(): string {
  return (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "https://anchor-be6o.onrender.com").replace(/\/$/, "");
}

export function briefLinkFor(userId: string): string {
  return `${siteUrl()}/brief/${createBriefToken(userId)}`;
}

type BriefRow = typeof morningBriefs.$inferSelect;

export async function getBriefRow(userId: string): Promise<BriefRow | null> {
  const [row] = await db.select().from(morningBriefs).where(eq(morningBriefs.userId, userId));
  return row ?? null;
}

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

async function buildSnapshot(params: {
  userId: string;
  user: typeof users.$inferSelect;
  prefs: MorningBriefPrefs;
  shown: ShownState;
  dismissed: Record<string, string>;
  localDate: string;
}): Promise<{ snapshot: BriefSnapshot; candidateIds: string[]; draftTargets: { email: BriefEmail; messageId: string; messageIdHeader: string | null; dealId: string | null }[] }> {
  const { userId, user, prefs, shown, dismissed, localDate } = params;
  const access = await accessibleDealIds(userId);
  const visibleDeals = access
    ? await db
        .select({ id: deals.id, name: deals.name, primaryContactEmail: deals.primaryContactEmail, leadUserId: deals.leadUserId })
        .from(deals)
        .where(dealVisibilityWhere(access))
    : [];
  const dealIds = visibleDeals.map((d) => d.id);

  // Who's on which deal, by email: the deal's main contact plus anyone
  // Anchor has seen on its calls.
  const dealByEmail = new Map<string, { id: string; name: string }>();
  for (const d of visibleDeals) if (d.primaryContactEmail) dealByEmail.set(d.primaryContactEmail.toLowerCase(), { id: d.id, name: d.name });
  if (dealIds.length) {
    const rows = await db
      .selectDistinct({ dealId: meetings.dealId, email: contacts.email })
      .from(meetingParticipants)
      .innerJoin(meetings, eq(meetingParticipants.meetingId, meetings.id))
      .innerJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
      .where(inArray(meetings.dealId, dealIds));
    const name = new Map(visibleDeals.map((d) => [d.id, d.name]));
    for (const r of rows) {
      if (r.dealId && r.email && !dealByEmail.has(r.email.toLowerCase())) {
        dealByEmail.set(r.email.toLowerCase(), { id: r.dealId, name: name.get(r.dealId) ?? "" });
      }
    }
  }

  const snapshot: BriefSnapshot = {
    date: localDate,
    googleConnected: false,
    emails: [],
    moreEmails: 0,
    tasks: [],
    moreTasks: 0,
    meetings: [],
    quietDeals: [],
  };
  const candidateIds: string[] = [];
  const draftTargets: { email: BriefEmail; messageId: string; messageIdHeader: string | null; dealId: string | null }[] = [];

  // --- Emails waiting on a reply
  if (prefs.include.emails) {
    try {
      const inbox = await fetchThreadsAwaitingReply(userId, { lookbackDays: prefs.lookbackDays, extraMyEmails: [user.email] });
      snapshot.googleConnected = inbox.connected;
      let threads = inbox.threads.filter((t) => shouldShowToday(t.threadId, localDate, prefs, shown, dismissed));
      if (prefs.emailScope === "deals") threads = threads.filter((t) => dealByEmail.has(t.fromEmail));
      candidateIds.push(...threads.map((t) => t.threadId));
      const accountParam = inbox.account ? `?authuser=${encodeURIComponent(inbox.account)}` : "";
      const waiting = (t: { receivedAt: Date }) =>
        Math.max(0, daysBetween(localNow(prefs.timeZone, t.receivedAt).date, localDate));

      let triage = new Map<number, { needsReply: boolean; summary: string; priority: 1 | 2 | 3 }>();
      try {
        const results = await triageEmails(
          user.name || user.email,
          threads.slice(0, 25).map((t, i) => ({
            id: i,
            fromName: t.fromName,
            fromEmail: t.fromEmail,
            subject: t.subject,
            snippet: t.snippet,
            deal: dealByEmail.get(t.fromEmail)?.name ?? null,
            waitingDays: waiting(t),
            addressedToMe: t.addressedToMe,
          }))
        );
        triage = new Map(results.map((r) => [r.id, r]));
      } catch (err) {
        // Without the AI step, still list the emails, by subject.
        console.error("[morningBrief] triage failed, falling back to subjects:", err);
        triage = new Map(threads.slice(0, 25).map((t, i) => [i, { needsReply: true, summary: t.subject, priority: dealByEmail.has(t.fromEmail) ? 1 : 3 }]));
      }

      const picked: { email: BriefEmail; thread: (typeof threads)[number] }[] = [];
      threads.slice(0, 25).forEach((t, i) => {
        const r = triage.get(i);
        if (!r?.needsReply) return;
        const deal = dealByEmail.get(t.fromEmail) ?? null;
        picked.push({
          thread: t,
          email: {
            threadId: t.threadId,
            fromName: t.fromName,
            fromEmail: t.fromEmail,
            subject: t.subject,
            summary: r.summary || t.subject,
            waitingDays: waiting(t),
            reminder: (shown[t.threadId]?.on === localDate ? shown[t.threadId].n : (shown[t.threadId]?.n ?? 0) + 1) || 1,
            deal: deal?.name ?? null,
            priority: deal ? 1 : r.priority,
            gmailUrl: `https://mail.google.com/mail/u/0/${accountParam}#all/${t.threadId}`,
            drafted: Boolean(shown[t.threadId]?.drafted),
          },
        });
      });
      const ranked = rankEmails(picked.map((p) => p.email));
      snapshot.emails = ranked.slice(0, MAX_EMAILS);
      snapshot.moreEmails = Math.max(0, ranked.length - MAX_EMAILS);
      for (const e of snapshot.emails.slice(0, MAX_DRAFTS)) {
        const p = picked.find((x) => x.email.threadId === e.threadId)!;
        draftTargets.push({ email: e, messageId: p.thread.messageId, messageIdHeader: p.thread.messageIdHeader, dealId: dealByEmail.get(e.fromEmail)?.id ?? null });
      }
    } catch (err) {
      console.error("[morningBrief] reading Gmail failed:", err);
    }
  }

  // --- Open to-dos: ones named for this person, or on deals they lead.
  if (prefs.include.tasks && access && dealIds.length) {
    const rows = await db
      .select({ text: tasks.text, ownerLabel: tasks.ownerLabel, dealId: tasks.dealId, createdAt: tasks.createdAt })
      .from(tasks)
      .where(and(eq(tasks.teamId, access.teamId), eq(tasks.completed, false), or(isNull(tasks.dealId), inArray(tasks.dealId, dealIds))))
      .orderBy(tasks.createdAt)
      .limit(200);
    // A to-do is theirs if it names them in full, or by first name alone
    // ("Sam"), never on a shared surname.
    const fullName = words(user.name || "").join(" ");
    const first = words(user.name || "")[0];
    const isMine = (label: string) => {
      const w = words(label);
      return Boolean(fullName && (w.join(" ").includes(fullName) || (w.length === 1 && w[0] === first)));
    };
    const leads = new Set(visibleDeals.filter((d) => d.leadUserId === userId).map((d) => d.id));
    const dealName = new Map(visibleDeals.map((d) => [d.id, d.name]));
    const mine = rows.filter((t) =>
      t.ownerLabel ? isMine(t.ownerLabel) : t.dealId ? leads.has(t.dealId) : false
    );
    snapshot.tasks = mine.slice(0, MAX_TASKS).map((t) => ({ text: t.text, deal: t.dealId ? dealName.get(t.dealId) ?? null : null }));
    snapshot.moreTasks = Math.max(0, mine.length - MAX_TASKS);
  }

  // --- Today's meetings with deal contacts (Google Calendar).
  if (prefs.include.meetings && visibleDeals.length) {
    const emailsByDeal = new Map<string, string[]>();
    for (const [email, d] of dealByEmail) emailsByDeal.set(d.id, [...(emailsByDeal.get(d.id) ?? []), email]);
    try {
      const todays = await fetchTodaysDealMeetings(
        userId,
        visibleDeals.map((d) => ({ dealId: d.id, dealName: d.name, emails: emailsByDeal.get(d.id) ?? [] }))
      );
      snapshot.meetings = todays
        .filter((m) => localNow(prefs.timeZone, new Date(m.start)).date === localDate)
        .map((m) => ({
          time: new Date(m.start).toLocaleTimeString("en-US", { timeZone: prefs.timeZone, hour: "numeric", minute: "2-digit" }),
          title: m.summary,
          deal: m.dealName,
        }));
    } catch (err) {
      console.error("[morningBrief] reading Calendar failed:", err);
    }
  }

  // --- Deals going quiet.
  if (prefs.include.quietDeals && user.teamId) {
    const { staleDeals } = await getAttentionItems({ teamId: user.teamId, userId });
    snapshot.quietDeals = staleDeals.slice(0, 3).map((d) => ({ name: d.name, days: d.daysSince }));
  }

  return { snapshot, candidateIds, draftTargets };
}

// Puts a suggested reply in the person's Gmail drafts for the top emails,
// once per thread, if they turned that on and gave Anchor permission.
async function draftReplies(
  userId: string,
  user: typeof users.$inferSelect,
  targets: { email: BriefEmail; messageId: string; messageIdHeader: string | null; dealId: string | null }[],
  shown: ShownState
) {
  const connection = await getGoogleConnection(userId);
  if (!connection || !(connection.scope ?? "").split(/\s+/).includes(GOOGLE_EXTRA_SCOPES.gmail_compose)) return;
  const style = await getDealLeadStyle(userId, { allowSynchronousRebuild: false });
  for (const t of targets) {
    if (shown[t.email.threadId]?.drafted) continue;
    try {
      const [text, deal] = await Promise.all([
        fetchMessageText(userId, t.messageId),
        t.dealId ? db.select({ memory: deals.memory }).from(deals).where(eq(deals.id, t.dealId)).then((r) => r[0]) : Promise.resolve(null),
      ]);
      const body = await draftReply({
        senderName: user.name || user.email,
        style,
        fromName: t.email.fromName,
        subject: t.email.subject,
        messageText: text || t.email.summary,
        dealContext: deal?.memory ? deal.memory.slice(0, 1500) : null,
      });
      const subject = /^re:/i.test(t.email.subject) ? t.email.subject : `Re: ${t.email.subject}`;
      await createGmailDraft(
        userId,
        { to: [t.email.fromEmail], subject, body, inReplyTo: t.messageIdHeader ?? undefined },
        { threadId: t.email.threadId }
      );
      t.email.drafted = true;
    } catch (err) {
      console.error(`[morningBrief] drafting a reply for thread ${t.email.threadId} failed:`, err);
    }
  }
}

export type DeliveryResult = { sent: boolean; channel: BriefChannel; note?: string };

// Sends on the chosen channel; if that isn't available (no phone, texting
// not set up, Slack not connected or the send fails), falls back to email
// so the brief still arrives, and says why.
async function deliver(
  userId: string,
  user: typeof users.$inferSelect,
  prefs: MorningBriefPrefs,
  snapshot: BriefSnapshot,
  link: string
): Promise<DeliveryResult> {
  let note: string | undefined;
  if (prefs.channel === "sms") {
    if (!user.phone) note = "No phone number on your profile, so it came by email.";
    else if (!isSmsConfigured()) note = "Text messages aren't set up on Anchor yet, so it came by email.";
    else {
      const r = await sendSms(user.phone, renderBriefText(snapshot, link));
      if (r.sent) return { sent: true, channel: "sms" };
      note = "The text didn't go through, so it came by email.";
    }
  } else if (prefs.channel === "slack") {
    if (!(await getSlackConnection(userId))) note = "Slack isn't connected, so it came by email.";
    else {
      try {
        await sendSlackDirectMessage(userId, { toEmail: user.email, text: renderBriefSlack(snapshot, link) });
        return { sent: true, channel: "slack" };
      } catch (err) {
        console.error("[morningBrief] Slack send failed:", err);
        note = "The Slack message didn't go through, so it came by email.";
      }
    }
  }
  try {
    await sendEmail({
      to: user.email,
      subject: `Your morning brief: ${briefHeadline(snapshot)}`,
      html: renderBriefHtml(snapshot, link, user.name || "", note),
    });
    return { sent: true, channel: "email", note };
  } catch (err) {
    console.error("[morningBrief] email send failed:", err);
    return { sent: false, channel: "email", note: "Couldn't send the email." };
  }
}

export type RunResult =
  | { status: "sent"; delivery: DeliveryResult; snapshot: BriefSnapshot; text: string }
  | { status: "empty"; snapshot: BriefSnapshot }
  | { status: "failed"; error: string };

// Builds and sends one person's brief now, and records what it showed.
// `sendWhenEmpty`: "Send me one now" sends even an all-clear; the morning
// job stays quiet when there's nothing to say.
export async function runMorningBrief(userId: string, opts: { sendWhenEmpty?: boolean } = {}): Promise<RunResult> {
  return withAiUser({ userId }, async () => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return { status: "failed", error: "No such user" };
      const row = await getBriefRow(userId);
      const prefs = normalizePrefs(row?.prefs);
      const shown: ShownState = { ...((row?.shown as ShownState) ?? {}) };
      const dismissed: Record<string, string> = { ...(row?.dismissed ?? {}) };
      const localDate = localNow(prefs.timeZone).date;

      const { snapshot, candidateIds, draftTargets } = await buildSnapshot({ userId, user, prefs, shown, dismissed, localDate });
      if (prefs.draftReplies && draftTargets.length) await draftReplies(userId, user, draftTargets, shown);

      // Remember what was shown today (for "remind me every N days"), and
      // forget threads that have dropped out of the inbox window.
      for (const e of snapshot.emails) {
        const prev = shown[e.threadId];
        shown[e.threadId] = { on: localDate, n: prev?.on === localDate ? prev.n : (prev?.n ?? 0) + 1, drafted: e.drafted || prev?.drafted };
      }
      const keep = new Set([...candidateIds, ...snapshot.emails.map((e) => e.threadId)]);
      for (const id of Object.keys(shown)) {
        if (!keep.has(id) && daysBetween(shown[id].on, localDate) > 30) delete shown[id];
      }
      for (const [id, until] of Object.entries(dismissed)) {
        if (until !== "done" && until < localDate && daysBetween(until, localDate) > 30) delete dismissed[id];
      }
      await db
        .insert(morningBriefs)
        .values({ userId, shown, dismissed, lastBrief: snapshot as unknown as Record<string, unknown>, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: morningBriefs.userId,
          set: { shown, dismissed, lastBrief: snapshot as unknown as Record<string, unknown>, updatedAt: new Date() },
        });

      if (isEmptyBrief(snapshot) && !opts.sendWhenEmpty) return { status: "empty", snapshot };
      const link = briefLinkFor(userId);
      const delivery = await deliver(userId, user, prefs, snapshot, link);
      return { status: "sent", delivery, snapshot, text: renderBriefText(snapshot, link) };
    } catch (err) {
      console.error(`[morningBrief] run failed for ${userId}:`, err);
      return { status: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  });
}

// Marks one email done (stops reminders) or snoozes it for `days`.
export async function dismissBriefItem(userId: string, threadId: string, action: "done" | "snooze", days = 3) {
  const row = await getBriefRow(userId);
  const prefs = normalizePrefs(row?.prefs);
  const today = localNow(prefs.timeZone).date;
  const until = action === "done" ? "done" : new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const dismissed = { ...(row?.dismissed ?? {}), [threadId]: until };
  await db
    .insert(morningBriefs)
    .values({ userId, dismissed, updatedAt: new Date() })
    .onConflictDoUpdate({ target: morningBriefs.userId, set: { dismissed, updatedAt: new Date() } });
  return until;
}

// The hourly job: everyone whose brief is due right now (see isBriefDue).
// Claims each person's day before sending, so an overlapping or retried
// run never sends twice; gives the day back if the send fails, so the next
// hourly run tries again.
export async function runDueMorningBriefs(now: Date = new Date()) {
  const rows = await db
    .select({ userId: morningBriefs.userId, prefs: morningBriefs.prefs, lastSentOn: morningBriefs.lastSentOn })
    .from(morningBriefs)
    .innerJoin(users, eq(users.id, morningBriefs.userId))
    .innerJoin(teams, eq(teams.id, users.teamId))
    .where(eq(morningBriefs.enabled, true));

  const summary = { checked: rows.length, sent: 0, empty: 0, failed: 0 };
  for (const r of rows) {
    const prefs = normalizePrefs(r.prefs);
    const { due, localDate } = isBriefDue(prefs, r.lastSentOn, now);
    if (!due) continue;
    const claimed = await db
      .update(morningBriefs)
      .set({ lastSentOn: localDate })
      .where(
        and(
          eq(morningBriefs.userId, r.userId),
          r.lastSentOn === null ? isNull(morningBriefs.lastSentOn) : eq(morningBriefs.lastSentOn, r.lastSentOn)
        )
      )
      .returning({ userId: morningBriefs.userId });
    if (!claimed.length) continue;
    const result = await runMorningBrief(r.userId);
    if (result.status === "sent" && result.delivery.sent) summary.sent++;
    else if (result.status === "empty") summary.empty++;
    else {
      summary.failed++;
      await db.update(morningBriefs).set({ lastSentOn: r.lastSentOn }).where(eq(morningBriefs.userId, r.userId));
    }
  }
  return summary;
}
