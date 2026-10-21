// Finds the email threads still waiting on this person's reply, for the
// Morning brief (src/lib/morningBrief.ts): recent inbox threads whose
// latest message came from someone else, was addressed to them, and isn't
// a newsletter, notification or other automated mail. Read-only, within
// the gmail.readonly scope the Google connection already has.
import { getGoogleConnection, googleGet } from "./google";
import { extractBody, stripQuotedReply, type GmailPart } from "./gmail";
import { addresses, decodeEntities, header, looksAwaitingReply, parseAddress, replyAllFor, type GmailMessage, type ReplyAll } from "./gmailHeaders";

export { looksAwaitingReply, parseAddress };

export type AwaitingThread = {
  threadId: string;
  // Gmail's id for the latest message, and its RFC 822 Message-ID header
  // (for threading a drafted reply).
  messageId: string;
  messageIdHeader: string | null;
  subject: string;
  fromName: string;
  fromEmail: string;
  receivedAt: Date;
  snippet: string;
  addressedToMe: boolean;
  messageCount: number;
  // Recipients and threading headers for a reply-all to the latest message.
  replyAll: ReplyAll;
};

const MAX_THREADS = 30;
const METADATA_QUERY = ["From", "To", "Cc", "Reply-To", "Subject", "Date", "Message-ID", "References", "In-Reply-To", "List-Unsubscribe", "List-Id", "Precedence", "Auto-Submitted"]
  .map((h) => `metadataHeaders=${encodeURIComponent(h)}`)
  .join("&");
const CONCURRENCY = 5;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export async function fetchThreadsAwaitingReply(
  userId: string,
  opts: { lookbackDays: number; extraMyEmails?: string[] }
): Promise<{ connected: boolean; account: string | null; threads: AwaitingThread[] }> {
  const connection = await getGoogleConnection(userId);
  if (!connection) return { connected: false, account: null, threads: [] };

  const myEmails = new Set(
    [connection.externalAccountEmail, ...(opts.extraMyEmails ?? [])].filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase())
  );
  const q = `in:inbox newer_than:${opts.lookbackDays}d -category:promotions -category:social -category:forums -category:updates -from:me`;
  let accessToken = connection.accessToken;
  const list = await googleGet(
    connection,
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${MAX_THREADS}&q=${encodeURIComponent(q)}`
  );
  accessToken = list.accessToken;
  const ids = Array.isArray(list.json.threads)
    ? (list.json.threads as { id?: string }[]).map((t) => t.id).filter((id): id is string => Boolean(id))
    : [];

  const metadata = METADATA_QUERY;

  const threads = await mapLimit(ids, CONCURRENCY, async (id): Promise<AwaitingThread | null> => {
    try {
      const { json } = await googleGet(
        connection,
        accessToken,
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=metadata&${metadata}`
      );
      const messages = (Array.isArray(json.messages) ? json.messages : []) as GmailMessage[];
      // A draft at the end is the person's own unsent reply: judge the
      // thread by the last real message.
      const real = messages.filter((m) => !(m.labelIds ?? []).includes("DRAFT"));
      const last = real[real.length - 1];
      if (!last?.id || !looksAwaitingReply(last, myEmails)) return null;
      const from = parseAddress(header(last, "From"));
      const firstSubject = header(real[0], "Subject") || header(last, "Subject");
      return {
        threadId: id,
        messageId: last.id,
        messageIdHeader: header(last, "Message-ID") || null,
        subject: firstSubject || "(no subject)",
        fromName: from.name,
        fromEmail: from.email,
        receivedAt: new Date(Number(last.internalDate) || Date.now()),
        snippet: decodeEntities(last.snippet ?? "").slice(0, 400),
        addressedToMe: addresses(header(last, "To")).some((a) => myEmails.has(a)),
        messageCount: real.length,
        replyAll: replyAllFor(last, myEmails, firstSubject),
      };
    } catch (err) {
      console.error(`[gmailInbox] couldn't read thread ${id}:`, err);
      return null;
    }
  });

  return {
    connected: true,
    account: connection.externalAccountEmail,
    threads: threads.filter((t): t is AwaitingThread => t !== null),
  };
}

// Everyone a reply-all goes to right now, read from the thread itself:
// for saving a reply written earlier (a brief from before replyAll was
// recorded, or people added to the thread since). Null when the thread
// can't be read.
export async function fetchReplyAll(
  userId: string,
  threadId: string,
  extraMyEmails: string[] = []
): Promise<{ replyAll: ReplyAll; messageIdHeader: string | null } | null> {
  const connection = await getGoogleConnection(userId);
  if (!connection) return null;
  const myEmails = new Set(
    [connection.externalAccountEmail, ...extraMyEmails].filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase())
  );
  const { json } = await googleGet(
    connection,
    connection.accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&${METADATA_QUERY}`
  );
  const messages = ((Array.isArray(json.messages) ? json.messages : []) as GmailMessage[]).filter(
    (m) => !(m.labelIds ?? []).includes("DRAFT")
  );
  const last = messages[messages.length - 1];
  if (!last) return null;
  return {
    replyAll: replyAllFor(last, myEmails, header(messages[0], "Subject")),
    messageIdHeader: header(last, "Message-ID") || null,
  };
}

// The latest message's own text (quoted history trimmed), for drafting a
// reply to it.
export async function fetchMessageText(userId: string, messageId: string, maxChars = 4000): Promise<string> {
  const connection = await getGoogleConnection(userId);
  if (!connection) return "";
  const { json } = await googleGet(
    connection,
    connection.accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`
  );
  const body = extractBody(json.payload as GmailPart | undefined);
  return stripQuotedReply(body).slice(0, maxChars) || (typeof json.snippet === "string" ? json.snippet : "");
}

// Replies this person actually sent, newest first — how they really
// write (greeting, length, tone, sign-off), for drafting replies that
// sound like them. Prefers ones to `toEmail` when given.
export type SentReply = { to: string; subject: string; text: string };

export async function fetchMySentReplies(
  userId: string,
  opts: { toEmail?: string | null; max: number }
): Promise<SentReply[]> {
  const connection = await getGoogleConnection(userId);
  if (!connection) return [];
  let accessToken = connection.accessToken;
  const search = async (q: string, limit: number) => {
    const list = await googleGet(
      connection,
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&q=${encodeURIComponent(q)}`
    );
    accessToken = list.accessToken;
    return Array.isArray(list.json.messages)
      ? (list.json.messages as { id?: string }[]).map((m) => m.id).filter((id): id is string => Boolean(id))
      : [];
  };
  const base = "in:sent newer_than:120d subject:re";
  const ids = [
    ...(opts.toEmail ? await search(`${base} to:${opts.toEmail}`, 4) : []),
    ...(await search(base, 12)),
  ].filter((id, i, all) => all.indexOf(id) === i);

  const out: SentReply[] = [];
  for (const id of ids) {
    if (out.length >= opts.max) break;
    try {
      const { json } = await googleGet(connection, accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
      const m = json as unknown as GmailMessage & { payload?: GmailPart };
      const text = stripQuotedReply(extractBody(m.payload)).trim();
      // Skip one-liners ("Thanks!") — they don't show how they write.
      if (text.length < 80) continue;
      out.push({ to: parseAddress(header(m, "To")).name || header(m, "To"), subject: header(m, "Subject"), text: text.slice(0, 900) });
    } catch {
      // Skip a message that can't be read.
    }
  }
  return out;
}

// What this person sent in a thread after `afterMessageId` (Gmail's id),
// if anything — used to learn from how they changed a suggested reply.
export async function fetchMyReplyInThread(userId: string, threadId: string, afterMessageId: string): Promise<string | null> {
  const connection = await getGoogleConnection(userId);
  if (!connection) return null;
  const myEmail = (connection.externalAccountEmail ?? "").toLowerCase();
  const { json } = await googleGet(
    connection,
    connection.accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`
  );
  const messages = (Array.isArray(json.messages) ? json.messages : []) as (GmailMessage & { payload?: GmailPart })[];
  const start = messages.findIndex((m) => m.id === afterMessageId);
  if (start < 0) return null;
  for (const m of messages.slice(start + 1)) {
    const labels = m.labelIds ?? [];
    const fromMe = labels.includes("SENT") || (myEmail && parseAddress(header(m, "From")).email === myEmail);
    if (!fromMe || labels.includes("DRAFT")) continue;
    const text = stripQuotedReply(extractBody(m.payload)).trim();
    if (text) return text.slice(0, 1500);
  }
  return null;
}
