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
};

function encodeHeader(v: string): string {
  // RFC 2047 so names/subjects with accents or em dashes survive
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}
function stripCRLF(v: string): string {
  return v.replace(/[\r\n]+/g, " ").trim(); // prevent header injection
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
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const body = Buffer.from(d.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
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
