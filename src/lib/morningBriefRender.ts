// The Morning brief's rules and wording that don't need the database:
// which waiting emails to show today, and the brief itself as a text
// message, an email and a Slack message. Kept free of database imports so
// scripts/test-next-steps.ts can run it.
import { daysBetween, type MorningBriefPrefs } from "./morningBriefPrefs";
import type { ReplyAll } from "./integrations/gmailHeaders";

export type BriefEmail = {
  threadId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  summary: string;
  waitingDays: number;
  // Which brief this is in a row for this email (1 = first time).
  reminder: number;
  deal: string | null;
  priority: 1 | 2 | 3;
  gmailUrl: string;
  drafted: boolean;
  // For the most important emails: how to handle it in this deal, and a
  // ready-to-send reply (also put in Gmail drafts when that's turned on).
  approach?: string | null;
  reply?: string | null;
  // A meeting the email asks for or proposes, to add to the calendar with
  // one click from the brief page (start is local, in timeZone).
  meeting?: {
    title: string;
    start: string;
    durationMinutes: number;
    timeZone: string;
    // Approved (added to a calendar) or declined; unset while undecided.
    added?: boolean;
    declined?: boolean;
  } | null;
  // The latest message's Message-ID header, so a reply saved to Gmail
  // drafts from the brief threads under it.
  replyToHeader?: string | null;
  // Everyone a reply-all goes to, and the headers that keep it in this
  // conversation (see replyAllFor in gmailHeaders.ts).
  replyAll?: ReplyAll | null;
};

export type BriefSnapshot = {
  date: string; // the person's local YYYY-MM-DD
  googleConnected: boolean;
  // Why emails couldn't be read this time, when Google is connected but
  // Gmail failed (so the brief says that, not "connect Google").
  emailError?: string;
  // The person turned emails off in their brief settings.
  emailsOff?: boolean;
  emails: BriefEmail[];
  moreEmails: number;
  tasks: { text: string; deal: string | null }[];
  moreTasks: number;
  meetings: { time: string; title: string; deal: string | null }[];
  quietDeals: { name: string; days: number }[];
};

export type ShownState = Record<
  string,
  {
    on: string;
    n: number;
    drafted?: boolean;
    // The reply written for the thread's latest message, kept so it isn't
    // rewritten every morning; a newer message gets a new one.
    reply?: {
      forMessage: string;
      body: string;
      approach: string;
      meeting?: { title: string; start: string; durationMinutes: number } | null;
    };
    // What they actually sent after that suggestion, once found — how
    // they change Anchor's replies, learned from for the next ones.
    sent?: string;
    // The day the thread was last checked for what they sent.
    sentCheckedOn?: string;
    // When a reply was put in Gmail drafts between briefs, for a thread
    // not yet in a brief (whose `on` is still empty).
    draftedOn?: string;
    // The suggested meeting was added to their calendar, or declined.
    meetingAdded?: boolean;
    meetingDeclined?: boolean;
  }
>;

// An email still waiting on a reply comes back every `remindEveryDays`
// (1 = every brief) until it's answered, marked done, or snoozed.
export function shouldShowToday(
  threadId: string,
  localDate: string,
  prefs: Pick<MorningBriefPrefs, "remindEveryDays">,
  shown: ShownState,
  dismissed: Record<string, string>
): boolean {
  const d = dismissed[threadId];
  if (d === "done") return false;
  if (d && d > localDate) return false; // snoozed until a later date
  const last = shown[threadId];
  // Not in a brief yet (only a reply drafted for it, see autoDraftReplies).
  if (!last || !last.on) return true;
  if (last.on === localDate) return true; // same day (a "send me one now" re-run)
  return daysBetween(last.on, localDate) >= prefs.remindEveryDays;
}

// Most important first: customers and deal contacts, then the longest
// waiting.
export function rankEmails(emails: BriefEmail[]): BriefEmail[] {
  return [...emails].sort(
    (a, b) =>
      a.priority - b.priority ||
      Number(Boolean(b.deal)) - Number(Boolean(a.deal)) ||
      b.waitingDays - a.waitingDays
  );
}

export function isEmptyBrief(b: BriefSnapshot): boolean {
  return !b.emails.length && !b.tasks.length && !b.meetings.length && !b.quietDeals.length;
}

function waited(e: BriefEmail): string {
  const days = e.waitingDays <= 0 ? "today" : `${e.waitingDays}d`;
  return e.reminder > 1 ? `${days}, reminder ${e.reminder}` : days;
}

function firstName(name: string): string {
  const n = name.trim();
  if (!n || n.includes("@")) return n.split("@")[0];
  return n.split(/\s+/)[0];
}

export function briefHeadline(b: BriefSnapshot): string {
  const parts: string[] = [];
  if (b.emails.length) parts.push(`${b.emails.length + b.moreEmails} to reply to`);
  if (b.meetings.length) parts.push(`${b.meetings.length} meeting${b.meetings.length === 1 ? "" : "s"}`);
  if (b.tasks.length) parts.push(`${b.tasks.length + b.moreTasks} to-do${b.tasks.length + b.moreTasks === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "nothing urgent";
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// A text message: the essentials, short enough to read at a glance.
export function renderBriefText(b: BriefSnapshot, link: string): string {
  const lines: string[] = [`Anchor · ${dayLabel(b.date)}`];
  if (b.emails.length) {
    lines.push("", `Reply to (${b.emails.length + b.moreEmails}):`);
    for (const e of b.emails.slice(0, 5)) {
      lines.push(`• ${firstName(e.fromName)}${e.deal ? ` (${e.deal})` : ""}: ${e.summary} – ${waited(e)}`);
    }
    const extra = b.emails.length + b.moreEmails - Math.min(b.emails.length, 5);
    if (extra > 0) lines.push(`+${extra} more`);
  }
  if (b.meetings.length) {
    lines.push("", `Today: ${b.meetings.map((m) => `${m.time} ${m.title}`).join("; ")}`);
  }
  if (b.tasks.length) {
    const more = b.tasks.length - 1 + b.moreTasks;
    lines.push("", `To do: ${b.tasks[0].text}${more > 0 ? ` (+${more} more)` : ""}`);
  }
  if (b.quietDeals.length) {
    lines.push("", `Gone quiet: ${b.quietDeals.map((d) => `${d.name} ${d.days}d`).join(", ")}`);
  }
  if (b.emails.some((e) => e.drafted)) lines.push("", "Reply drafts are waiting in your Gmail.");
  else if (b.emails.some((e) => e.reply)) lines.push("", "Suggested replies are on your brief page.");
  lines.push("", `Done / snooze: ${link}`);
  return lines.join("\n");
}

// Slack message (mrkdwn).
export function renderBriefSlack(b: BriefSnapshot, link: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines: string[] = [`*Your morning brief* · ${dayLabel(b.date)} · ${briefHeadline(b)}`];
  if (b.emails.length) {
    lines.push("", "*Waiting on your reply*");
    for (const e of b.emails) {
      lines.push(`• <${e.gmailUrl}|${esc(e.fromName)}>${e.deal ? ` (${esc(e.deal)})` : ""}: ${esc(e.summary)} _(${waited(e)})_${e.drafted ? " · draft ready" : ""}`);
      if (e.approach) lines.push(`   ↳ _${esc(e.approach)}_`);
    }
    if (b.moreEmails) lines.push(`+${b.moreEmails} more`);
  }
  if (b.meetings.length) {
    lines.push("", "*Today*", ...b.meetings.map((m) => `• ${m.time} ${esc(m.title)}`));
  }
  if (b.tasks.length) {
    lines.push("", "*To do*", ...b.tasks.map((t) => `• ${esc(t.text)}${t.deal ? ` (${esc(t.deal)})` : ""}`));
    if (b.moreTasks) lines.push(`+${b.moreTasks} more`);
  }
  if (b.quietDeals.length) {
    lines.push("", `*Gone quiet:* ${b.quietDeals.map((d) => `${esc(d.name)} (${d.days}d)`).join(", ")}`);
  }
  lines.push("", `<${link}|${b.emails.some((e) => e.reply) ? "See the suggested replies, mark done or snooze" : "Mark done or snooze"}>`);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// The email: table layout and inline styles, like the other Anchor emails.
// `note`: shown at the top, e.g. why it came by email instead of text.
export function renderBriefHtml(b: BriefSnapshot, link: string, personName: string, note?: string): string {
  const brand = "#12294a";
  const accent = "#b4531f";
  const section = (title: string, body: string) =>
    `<tr><td style="padding:22px 28px 0;"><p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">${title}</p>${body}</td></tr>`;
  const actionLink = (threadId: string, action: "done" | "snooze", label: string) =>
    `<a href="${link}?item=${encodeURIComponent(threadId)}&amp;do=${action}" style="color:#64748b;text-decoration:underline;font-size:12px;">${label}</a>`;

  const emailCard = (e: BriefEmail) => `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border:1px solid #e2e8f0;border-radius:10px;"><tr><td style="padding:12px 14px;">
        <p style="margin:0;font-size:14px;color:#0f172a;"><a href="${escapeHtml(e.gmailUrl)}" style="color:${brand};font-weight:700;text-decoration:none;">${escapeHtml(e.fromName)}</a></p>
        <p style="margin:4px 0 0;font-size:14px;line-height:1.5;color:#334155;">${escapeHtml(e.summary)}</p>
        <p style="margin:6px 0 0;font-size:12px;color:${e.waitingDays >= 3 ? accent : "#94a3b8"};">Waiting ${e.waitingDays <= 0 ? "since today" : `${e.waitingDays} day${e.waitingDays === 1 ? "" : "s"}`}${e.reminder > 1 ? ` · reminder ${e.reminder}` : ""}${e.drafted ? " · reply draft in Gmail" : ""}
        &nbsp; ${actionLink(e.threadId, "done", "Done")} &nbsp; ${actionLink(e.threadId, "snooze", "Snooze 3 days")}</p>${
          e.approach
            ? `<p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:${brand};"><strong>How to handle it:</strong> ${escapeHtml(e.approach)}</p>`
            : ""
        }${
          e.reply
            ? `${
                e.meeting
                  ? `<p style="margin:8px 0 0;font-size:13px;color:${brand};"><strong>Suggested meeting:</strong> ${escapeHtml(e.meeting.title)} · ${escapeHtml(meetingWhen(e.meeting))} — <a href="${link}?item=${encodeURIComponent(e.threadId)}" style="color:${accent};">add it to your calendar</a></p>`
                  : ""
              }<p style="margin:8px 0 0;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8;">Suggested reply</p><div style="margin:4px 0 0;padding:10px 12px;border-radius:8px;background:#f8fafc;border-left:3px solid ${accent};font-size:13px;line-height:1.55;color:#334155;white-space:pre-wrap;">${escapeHtml(e.reply)}</div><p style="margin:8px 0 0;font-size:13px;">${
                e.drafted
                  ? `<span style="color:#059669;font-weight:600;">✓ In your Gmail drafts</span>`
                  : `<a href="${link}?item=${encodeURIComponent(e.threadId)}&amp;do=draft" style="display:inline-block;padding:6px 12px;border-radius:6px;background:${brand};color:#ffffff;font-weight:600;text-decoration:none;">Save to Gmail drafts</a>`
              }</p>`
            : ""
        }
      </td></tr></table>`;
  // Grouped under each deal as a headline, then everything else.
  const groups = groupByDeal(b.emails);
  const emails =
    (b.emails.some((e) => e.reply && !e.drafted)
      ? `<p style="margin:0 0 12px;"><a href="${link}?do=draftall" style="display:inline-block;padding:8px 14px;border-radius:8px;background:${brand};color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;">Save all replies to Gmail drafts</a></p>`
      : "") +
    groups
      .map(
        (g) =>
          `${
            groups.length > 1 || g.deal
              ? `<p style="margin:14px 0 8px;font-size:15px;font-weight:700;color:${brand};">${g.deal ? escapeHtml(g.deal) : "Other emails"}</p>`
              : ""
          }${g.emails.map(emailCard).join("")}`
      )
      .join("");
  const list = (items: string[]) =>
    `<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;color:#334155;">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;

  const rows = [
    b.emails.length
      ? section(`Waiting on your reply (${b.emails.length + b.moreEmails})`, emails + (b.moreEmails ? `<p style="margin:0;font-size:13px;color:#64748b;">+${b.moreEmails} more on your brief page</p>` : ""))
      : b.emailError
        ? section("Emails", `<p style="margin:0;font-size:14px;color:#b45309;">Couldn't read your Gmail this time (${escapeHtml(b.emailError)}). Anchor tries again with the next brief.</p>`)
        : "",
    b.meetings.length ? section("Today", list(b.meetings.map((m) => `<strong>${escapeHtml(m.time)}</strong> ${escapeHtml(m.title)}`))) : "",
    b.tasks.length
      ? section(
          "To do",
          list(b.tasks.map((t) => `${escapeHtml(t.text)}${t.deal ? ` <span style="color:#94a3b8;">· ${escapeHtml(t.deal)}</span>` : ""}`)) +
            (b.moreTasks ? `<p style="margin:6px 0 0;font-size:13px;color:#64748b;">+${b.moreTasks} more</p>` : "")
        )
      : "",
    b.quietDeals.length ? section("Gone quiet", list(b.quietDeals.map((d) => `${escapeHtml(d.name)} <span style="color:#94a3b8;">· no call in ${d.days} days</span>`))) : "",
  ].join("");

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr><td style="background:${brand};padding:20px 28px;">
      <p style="margin:0;font-size:13px;color:#cbd5e1;">Anchor · ${escapeHtml(dayLabel(b.date))}</p>
      <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#ffffff;">Good morning${personName ? `, ${escapeHtml(firstName(personName))}` : ""}</p>
      <p style="margin:4px 0 0;font-size:14px;color:#e2e8f0;">${escapeHtml(briefHeadline(b))}</p>
      ${note ? `<p style="margin:10px 0 0;font-size:12px;color:#fcd34d;">${escapeHtml(note)}</p>` : ""}
    </td></tr>
    ${rows}
    <tr><td style="padding:22px 28px 26px;">
      <a href="${link}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:${accent};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Open your brief</a>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">Emails stay on your brief until you reply, mark them done or snooze them. Change the time, channel or what's included on your Anchor profile.</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

// "Thu, Oct 22, 10:00 AM (30 min)" for a suggested meeting.
export function meetingWhen(m: { start: string; durationMinutes: number }): string {
  const [date, time] = m.start.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d, 12)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const clock = `${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return `${day}, ${clock} (${m.durationMinutes} min)`;
}

// The brief's emails grouped by deal (each deal a headline, in the order
// the emails rank), then the ones not on a deal.
export function groupByDeal(emails: BriefEmail[]): { deal: string | null; emails: BriefEmail[] }[] {
  const groups: { deal: string | null; emails: BriefEmail[] }[] = [];
  for (const e of emails.filter((x) => x.deal)) {
    const g = groups.find((x) => x.deal === e.deal);
    if (g) g.emails.push(e);
    else groups.push({ deal: e.deal, emails: [e] });
  }
  const other = emails.filter((x) => !x.deal);
  if (other.length) groups.push({ deal: null, emails: other });
  return groups;
}
