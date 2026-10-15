// Finds the email threads still waiting on this person's reply, for the
// Morning brief (src/lib/morningBrief.ts): recent inbox threads whose
// latest message came from someone else, was addressed to them, and isn't
// a newsletter, notification or other automated mail. Read-only, within
// the gmail.readonly scope the Google connection already has.
import { getGoogleConnection, googleGet } from "./google";
import { extractBody, stripQuotedReply, type GmailPart } from "./gmail";
import { addresses, decodeEntities, header, looksAwaitingReply, parseAddress, type GmailMessage } from "./gmailHeaders";

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
};

const MAX_THREADS = 30;
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

  const metadata = ["From", "To", "Cc", "Subject", "Date", "Message-ID", "List-Unsubscribe", "List-Id", "Precedence", "Auto-Submitted"]
    .map((h) => `metadataHeaders=${encodeURIComponent(h)}`)
    .join("&");

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
