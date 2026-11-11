// Saves a Gmail DRAFT. Never sends: the user reviews and sends it from
// Gmail themselves. Needs the gmail.compose permission, which is asked for
// the first time someone clicks "Save to Gmail drafts" (see config.ts).
import { googleGet, googlePost, requireGoogleScope, type Connection } from "./google";
import { buildMime, quoteAttribution, type DraftInput } from "./gmailMime";
import { extractPart, stripHtml, type GmailPart } from "./gmail";

type ThreadMessage = { labelIds?: string[]; payload?: GmailPart & { headers?: { name: string; value: string }[] } };
const headerOf = (m: ThreadMessage, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

// The email a reply answers (the one with inReplyTo's Message-ID, else the
// thread's latest), as a quote: Gmail's API doesn't add the earlier chain
// to a draft the way its Reply button does, so it's added here. Its own
// quoted history comes with it, so the whole conversation is included.
async function loadQuote(connection: Connection, threadId: string, inReplyTo?: string): Promise<DraftInput["quote"]> {
  const { json } = await googleGet(
    connection,
    connection.accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`
  );
  const messages = ((Array.isArray(json.messages) ? json.messages : []) as ThreadMessage[]).filter(
    (m) => !(m.labelIds ?? []).includes("DRAFT")
  );
  const target =
    (inReplyTo && messages.find((m) => headerOf(m, "Message-ID").trim() === inReplyTo.trim())) || messages[messages.length - 1];
  if (!target) return undefined;
  const html = extractPart(target.payload, "text/html");
  const text = extractPart(target.payload, "text/plain") ?? (html ? stripHtml(html) : "");
  if (!html && !text) return undefined;
  return { attribution: quoteAttribution(headerOf(target, "Date"), headerOf(target, "From")), html, text };
}

// threadId files the draft as a reply in an existing thread (pair it with
// draft.inReplyTo).
export async function createGmailDraft(userId: string, draft: DraftInput, opts: { threadId?: string } = {}) {
  const connection = await requireGoogleScope(userId, "gmail_compose");
  // A reply carries the conversation below it. If reading the thread
  // fails, the draft is still saved, just without the quote.
  const quote =
    opts.threadId && !draft.quote
      ? await loadQuote(connection, opts.threadId, draft.inReplyTo).catch((err) => {
          console.error("[gmailDraft] couldn't read the thread to quote it:", err);
          return undefined;
        })
      : draft.quote;
  const raw = Buffer.from(buildMime({ ...draft, quote }), "utf8").toString("base64url");
  await googlePost(connection, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    message: opts.threadId ? { raw, threadId: opts.threadId } : { raw },
  });
  // Gmail has no stable link to a single draft, so open the Drafts folder,
  // in the right account if the user is signed in to several.
  const account = connection.externalAccountEmail;
  return {
    openUrl: account
      ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#drafts`
      : "https://mail.google.com/mail/#drafts",
  };
}
