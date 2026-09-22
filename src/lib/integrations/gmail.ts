// Read-only Gmail lookup for a deal — never sends, drafts, or modifies
// anything, matching the gmail.readonly scope requested at connect time
// (see src/lib/integrations/config.ts). Matched by participant email
// address, the one signal Gmail itself understands, rather than by deal
// or company name.
//
// Fetches the actual email body (not just Gmail's short auto-generated
// snippet) so dealIntegrationContext.ts's AI digest step (see
// extractDealEmailDigest in ../dealEmailDigest.ts) has real substance to
// work with — a promise, a number, a date only shows up in the body, not
// a 100-character preview.
import { getGoogleConnection, googleGet } from "./google";

const MAX_EMAILS = 12;
const LOOKBACK_DAYS = 120;
// Per-email cap on the extracted plain-text body, in characters — bounds
// the total prompt size handed to the digest step (12 emails x this is
// still well within a normal context window) without needing to be
// clever about which part of a long email matters most.
const MAX_BODY_CHARS = 3000;

export type EmailContextItem = { subject: string; from: string; date: string; body: string };

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};

// Gmail's body.data is base64url (RFC 4648 §5) — Node's Buffer supports
// that encoding name directly.
function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Recursively walks the MIME part tree for a plain-text body, falling
// back to HTML (stripped) if that's all there is. Skips attachments
// (anything with a filename) and picks the FIRST matching part — Gmail
// puts the actual message before any quoted-reply parts get merged in as
// plain text, and multipart/alternative's plain-text sibling is usually
// good enough on its own.
function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return "";

  function walk(part: GmailPart, preferredType: string): string | null {
    if (part.filename) return null; // attachment, not message body
    if (part.mimeType === preferredType && part.body?.data) {
      try {
        return decodeBase64Url(part.body.data);
      } catch {
        return null;
      }
    }
    for (const child of part.parts || []) {
      const found = walk(child, preferredType);
      if (found) return found;
    }
    return null;
  }

  const plain = walk(payload, "text/plain");
  if (plain) return plain;
  const html = walk(payload, "text/html");
  if (html) return stripHtml(html);
  // Single-part message with no explicit multipart wrapper.
  if (payload.body?.data) {
    try {
      const raw = decodeBase64Url(payload.body.data);
      return payload.mimeType === "text/html" ? stripHtml(raw) : raw;
    } catch {
      return "";
    }
  }
  return "";
}

// Trims the quoted history a reply drags along ("On ... wrote:",
// "-----Original Message-----", a block of "> " quoted lines, or an
// inline forwarded header) so each email contributes roughly ONE
// message's worth of new content instead of re-including the entire
// thread every time it's quoted again. Heuristic, not perfect — errs
// toward keeping content if a pattern doesn't clearly match.
function stripQuotedReply(text: string): string {
  const patterns = [
    /\n[ \t]*On .{0,120} wrote:\s*\n/i,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\nFrom:\s*.{0,120}\nSent:\s*.{0,120}\nTo:\s*/i,
    /\n_{5,}\n/,
  ];
  let cutIndex = text.length;
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m.index !== undefined && m.index < cutIndex) cutIndex = m.index;
  }
  let body = text.slice(0, cutIndex);

  // Drop trailing runs of "> " quoted lines even without a header match.
  const lines = body.split("\n");
  while (lines.length && /^\s*>/.test(lines[lines.length - 1])) lines.pop();
  body = lines.join("\n").trim();

  return body;
}

export async function fetchRelevantEmails(
  userId: string,
  participantEmails: string[]
): Promise<EmailContextItem[]> {
  const connection = await getGoogleConnection(userId);
  if (!connection) return [];

  const addresses = Array.from(new Set(participantEmails.filter(Boolean)));
  if (addresses.length === 0) return [];

  const addressQuery = addresses.map((e) => `(from:${e} OR to:${e})`).join(" OR ");
  const q = `(${addressQuery}) newer_than:${LOOKBACK_DAYS}d`;
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${MAX_EMAILS}&q=${encodeURIComponent(q)}`;

  let accessToken = connection.accessToken;
  const { json: listJson, accessToken: afterList } = await googleGet(connection, accessToken, listUrl);
  accessToken = afterList;

  const refs = Array.isArray(listJson.messages)
    ? (listJson.messages as { id?: string }[]).map((m) => m.id).filter((id): id is string => Boolean(id))
    : [];
  if (refs.length === 0) return [];

  const items: EmailContextItem[] = [];
  for (const id of refs) {
    try {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
      const { json: msg, accessToken: afterMsg } = await googleGet(connection, accessToken, msgUrl);
      accessToken = afterMsg;

      const payload = msg.payload as GmailPart | undefined;
      const headers = Array.isArray(payload?.parts) || payload
        ? ((payload as unknown as { headers?: { name: string; value: string }[] })?.headers ?? [])
        : [];
      const header = (name: string) => headers.find((h) => h.name === name)?.value || "";

      const rawBody = extractBody(payload);
      const body = stripQuotedReply(rawBody).slice(0, MAX_BODY_CHARS);

      items.push({
        subject: header("Subject") || "(no subject)",
        from: header("From"),
        date: header("Date"),
        body: body || (typeof msg.snippet === "string" ? msg.snippet : ""),
      });
    } catch (err) {
      // One message failing to fetch shouldn't drop every other one —
      // just skip it.
      console.error(`[gmail] failed to fetch message ${id}:`, err);
    }
  }
  return items;
}
