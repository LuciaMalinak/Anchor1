// Builds the raw RFC 822 message for a Gmail draft (see gmailDraft.ts).
// Kept free of database imports so scripts/test-next-steps.ts can run it.
export type DraftInput = {
  to: string[];
  cc?: string[];
  subject: string;
  body: string; // plain text
  // Message-ID of the email being replied to, so Gmail files the draft in
  // that thread (with the thread id passed to the drafts API).
  inReplyTo?: string;
  // The conversation's full References chain; defaults to inReplyTo alone.
  references?: string;
  // The email being replied to, quoted below the reply the way Gmail's own
  // Reply button does ("On …, X wrote:"), so the whole chain goes with it.
  quote?: { attribution: string; html: string | null; text: string };
};

function encodeHeader(v: string): string {
  // RFC 2047 so names/subjects with accents or em dashes survive
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}
function stripCRLF(v: string): string {
  return v.replace(/[\r\n]+/g, " ").trim(); // prevent header injection
}

const base64Body = (text: string) =>
  Buffer.from(text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textToHtml = (t: string) => escapeHtml(t).replace(/\r?\n/g, "<br>");

// The original email's HTML, ready to sit inside the quote: just what's in
// its <body>, without scripts, or inline images that wouldn't show (cid:).
function quotableHtml(html: string): string {
  const inner = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return inner
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<img[^>]+src=["']?cid:[^>]*>/gi, "");
}

export function buildMime(d: DraftInput): string {
  const references = d.references || d.inReplyTo;
  const headers = [
    d.to.length ? `To: ${d.to.map(stripCRLF).join(", ")}` : null, // Gmail allows a draft with no recipient yet
    d.cc?.length ? `Cc: ${d.cc.map(stripCRLF).join(", ")}` : null,
    `Subject: ${encodeHeader(stripCRLF(d.subject))}`,
    d.inReplyTo ? `In-Reply-To: ${stripCRLF(d.inReplyTo)}` : null,
    references ? `References: ${stripCRLF(references)}` : null,
    "MIME-Version: 1.0",
  ].filter(Boolean);

  if (!d.quote) {
    headers.push('Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64");
    return `${headers.join("\r\n")}\r\n\r\n${base64Body(d.body)}`;
  }

  // A reply with the earlier chain: plain text and HTML versions, quoted
  // the way Gmail quotes (its gmail_quote markup, so Gmail tucks the
  // history behind "…" exactly as it does for its own replies).
  const q = d.quote;
  const text = `${d.body}\n\n${q.attribution}\n${q.text
    .replace(/\r?\n/g, "\n")
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")}\n`;
  const html =
    `<div dir="ltr">${textToHtml(d.body)}</div><br>` +
    `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${escapeHtml(q.attribution)}<br></div>` +
    `<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">` +
    `${q.html ? quotableHtml(q.html) : textToHtml(q.text)}</blockquote></div>`;
  const boundary = `anchor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  return [
    headers.join("\r\n"),
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// "On Tue, Nov 10, 2026 at 3:16 PM Jackie B <jb@x.com> wrote:" from the
// original's Date and From headers, the way Gmail words it (in the
// sender's own time, as their Date header gives it).
export function quoteAttribution(dateHeader: string, fromHeader: string): string {
  const m = /(?:(\w{3}),\s*)?(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})/.exec(dateHeader);
  let when = dateHeader.trim();
  if (m) {
    const [, weekday, day, month, year, hh, mm] = m;
    const h = Number(hh);
    when = `${weekday ? `${weekday}, ` : ""}${month} ${Number(day)}, ${year} at ${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
  }
  return `On ${when} ${fromHeader.trim()} wrote:`;
}

// The Gmail draft for a reply to an email in the Morning brief: reply-all,
// in the same conversation. Emails from briefs saved before replyAll was
// recorded fall back to answering the sender alone.
export function replyDraft(
  email: {
    fromEmail: string;
    subject: string;
    replyToHeader?: string | null;
    replyAll?: { to: string[]; cc: string[]; subject: string; references: string | null } | null;
  },
  body: string
): DraftInput {
  const r = email.replyAll;
  return {
    to: r?.to.length ? r.to : [email.fromEmail],
    cc: r?.cc.length ? r.cc : undefined,
    subject: r?.subject || (/^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`),
    body,
    inReplyTo: email.replyToHeader ?? undefined,
    references: r?.references ?? undefined,
  };
}
