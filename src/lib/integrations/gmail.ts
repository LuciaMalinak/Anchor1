// Read-only Gmail lookup for a deal — never sends, drafts, or modifies
// anything, matching the gmail.readonly scope requested at connect time
// (see src/lib/integrations/config.ts). Matched by participant email
// address, the one signal Gmail itself understands, rather than by deal
// or company name.
import { getGoogleConnection, googleGet } from "./google";

const MAX_EMAILS = 8;
const LOOKBACK_DAYS = 120;

export type EmailContextItem = { subject: string; from: string; date: string; snippet: string };

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
      const msgUrl =
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
        `?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
      const { json: msg, accessToken: afterMsg } = await googleGet(connection, accessToken, msgUrl);
      accessToken = afterMsg;

      const headers = Array.isArray((msg.payload as Record<string, unknown> | undefined)?.headers)
        ? ((msg.payload as { headers: { name: string; value: string }[] }).headers)
        : [];
      const header = (name: string) => headers.find((h) => h.name === name)?.value || "";

      items.push({
        subject: header("Subject") || "(no subject)",
        from: header("From"),
        date: header("Date"),
        snippet: typeof msg.snippet === "string" ? msg.snippet : "",
      });
    } catch (err) {
      // One message failing to fetch shouldn't drop every other one —
      // just skip it.
      console.error(`[gmail] failed to fetch message ${id}:`, err);
    }
  }
  return items;
}
