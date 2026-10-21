// Header-only checks on Gmail messages for the Morning brief (see
// gmailInbox.ts). Kept free of database imports so
// scripts/test-next-steps.ts can run it.
export type Header = { name: string; value: string };
export type GmailMessage = {
  id?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Header[] };
};

const AUTOMATED_SENDER = /(^|[._+-])(no-?reply|do-?not-?reply|notifications?|notify|mailer-daemon|postmaster|bounce|alerts?|newsletter|updates?|news|digest|billing|receipts?|support-noreply)([._+-]|@)/i;

export function header(m: GmailMessage, name: string): string {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// "Dana Ruiz <dana@northwind.com>" -> { name: "Dana Ruiz", email: "dana@northwind.com" }
export function parseAddress(value: string): { name: string; email: string } {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  const email = value.trim().toLowerCase();
  return { name: email, email };
}

export function addresses(value: string): string[] {
  return (value.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? []).map((a) => a.toLowerCase());
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Whether the latest message in a thread still needs this person's reply,
// on headers alone (the AI step in morningBrief.ts makes the finer call).
// Exported for scripts/test-next-steps.ts.
export function looksAwaitingReply(m: GmailMessage, myEmails: Set<string>): boolean {
  const labels = m.labelIds ?? [];
  if (labels.includes("SENT") || labels.includes("DRAFT")) return false;
  const from = parseAddress(header(m, "From")).email;
  if (!from || myEmails.has(from)) return false;
  if (AUTOMATED_SENDER.test(from)) return false;
  if (header(m, "List-Unsubscribe") || header(m, "List-Id")) return false;
  const precedence = header(m, "Precedence").toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") return false;
  const auto = header(m, "Auto-Submitted").toLowerCase();
  if (auto && auto !== "no") return false;
  const recipients = [...addresses(header(m, "To")), ...addresses(header(m, "Cc"))];
  return recipients.some((r) => myEmails.has(r));
}


// Who a reply-all goes to and the headers that keep it in the same Gmail
// conversation, worked out from the message being answered. Mirrors
// Gmail's own Reply all: the sender (or their Reply-To) and everyone else
// on To go in To, everyone on Cc stays on Cc, and the person replying is
// left off both.
export type ReplyAll = {
  to: string[];
  cc: string[];
  // The answered message's subject with one "Re: " in front — Gmail only
  // files a draft into an existing conversation when the subject matches.
  subject: string;
  // Every Message-ID in the conversation so far, ending with the answered
  // one (RFC 5322 References), so mail apps thread the reply correctly.
  references: string | null;
};

export function replyAllFor(last: GmailMessage, myEmails: Set<string>, fallbackSubject = ""): ReplyAll {
  const seen = new Set(myEmails);
  const take = (list: string[]) =>
    list.filter((a) => {
      if (seen.has(a)) return false;
      seen.add(a);
      return true;
    });
  const replyTo = addresses(header(last, "Reply-To"));
  const to = take([...(replyTo.length ? replyTo : addresses(header(last, "From"))), ...addresses(header(last, "To"))]);
  const cc = take(addresses(header(last, "Cc")));
  const subject = (header(last, "Subject") || fallbackSubject || "").trim();
  const messageId = header(last, "Message-ID").trim();
  const earlier = (header(last, "References") || header(last, "In-Reply-To")).trim();
  const references = [earlier, messageId].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || null;
  return { to, cc, subject: /^re:/i.test(subject) ? subject : `Re: ${subject || "(no subject)"}`, references };
}
