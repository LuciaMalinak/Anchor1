// Slack messaging — separate from the OAuth connect/callback plumbing in
// config.ts/identity.ts, same split as google.ts (connection lookup) vs.
// gmail.ts/calendar.ts (what you actually do with it). This is what backs
// the "post updates back" half of Slack's description on the Integrations
// page — the connect button existed before this file did, but nothing
// actually sent a message until now.
//
// Slack's bot tokens (xoxb…, from the scopes this app requests —
// channels:history, chat:write, users:read) don't expire the way Google's
// or HubSpot's do, so unlike google.ts/hubspot.ts there's no refresh-token
// dance here: whatever's stored in accessToken is good until someone
// revokes it, at which point Slack's API calls fail with a plain error and
// the fix is just reconnecting from the Integrations page.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { SLACK_EXTRA_SCOPES, hasScopes } from "./config";

type Connection = typeof integrationConnections.$inferSelect;

export async function getSlackConnection(userId: string): Promise<Connection | null> {
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, "slack")))
    .limit(1);
  return connection ?? null;
}

async function slackCall(
  accessToken: string,
  method: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  // Slack's API always answers 200 and signals failure via `ok: false` in
  // the body (with a short machine-readable `error` code) rather than an
  // HTTP status — checking res.ok alone would miss almost every failure.
  if (!res.ok || json.ok !== true) {
    throw new Error(typeof json.error === "string" ? json.error : `Slack API request failed (${res.status})`);
  }
  return json;
}

export class SlackRecipientNotFoundError extends Error {}

// DMs `text` to whoever in the connecting user's Slack workspace has
// `toEmail` on file — the natural way to reach a specific teammate by
// their Anchor account, since Anchor doesn't otherwise know anyone's
// Slack member ID. `fromUserId` is whoever's Slack connection sends the
// message (the person clicking "Send to backup on Slack"), not the
// recipient — Slack has no notion of "DM as a specific other user" here,
// only "DM someone using this bot token."
export async function sendSlackDirectMessage(
  fromUserId: string,
  params: { toEmail: string; text: string }
): Promise<void> {
  const connection = await getSlackConnection(fromUserId);
  if (!connection) {
    throw new Error("Slack isn't connected yet — connect it from the Integrations page first.");
  }

  let lookup: Record<string, unknown>;
  try {
    lookup = await slackCall(connection.accessToken, "users.lookupByEmail", {});
  } catch {
    // users.lookupByEmail takes its param on the query string, not the
    // JSON body (one of a handful of Slack endpoints that predate its
    // JSON POST support) — retried as a GET below rather than special-
    // cased above, to keep slackCall's shape uniform for every other call.
    const res = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(params.toEmail)}`,
      { headers: { Authorization: `Bearer ${connection.accessToken}` } }
    );
    lookup = await res.json().catch(() => ({}));
  }

  if (lookup.ok !== true) {
    if (lookup.error === "users_not_found") {
      throw new SlackRecipientNotFoundError(
        `Couldn't find ${params.toEmail} in your Slack workspace — they may use a different email there, or aren't a member of it.`
      );
    }
    throw new Error(typeof lookup.error === "string" ? lookup.error : "Slack couldn't look up that person.");
  }

  const slackUser = lookup.user as { id?: string } | undefined;
  if (!slackUser?.id) {
    throw new SlackRecipientNotFoundError(`Couldn't find ${params.toEmail} in your Slack workspace.`);
  }

  const opened = await slackCall(connection.accessToken, "conversations.open", { users: slackUser.id });
  const channel = opened.channel as { id?: string } | undefined;
  if (!channel?.id) {
    throw new Error("Slack couldn't open a DM with that person.");
  }

  await slackCall(connection.accessToken, "chat.postMessage", {
    channel: channel.id,
    text: params.text,
  });
}

// Thrown when the Slack connection predates channel posting, so the
// meeting page can send them to Slack to add it (SLACK_EXTRA_SCOPES).
export class NeedsSlackPermissionError extends Error {}

async function postingConnection(userId: string): Promise<Connection> {
  const connection = await getSlackConnection(userId);
  if (!connection) {
    throw new Error("Slack isn't connected yet — connect it from the Integrations page first.");
  }
  if (!hasScopes(connection.scope, SLACK_EXTRA_SCOPES.post_channels)) {
    throw new NeedsSlackPermissionError("Anchor needs permission to post in Slack channels.");
  }
  return connection;
}

export type SlackChannel = { id: string; name: string };

// Public channels in the connected workspace, by name — what the recap
// card lets someone pick from.
export async function listSlackChannels(userId: string): Promise<SlackChannel[]> {
  const connection = await postingConnection(userId);
  const channels: SlackChannel[] = [];
  let cursor = "";
  // A few pages is plenty for a picker; very large workspaces get the
  // first 600 channels Slack returns.
  for (let page = 0; page < 3; page++) {
    const res = await fetch(
      `https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=200${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`,
      { headers: { Authorization: `Bearer ${connection.accessToken}` } }
    );
    const json = await res.json().catch(() => ({}));
    if (json.ok !== true) {
      if (json.error === "missing_scope") throw new NeedsSlackPermissionError("Anchor needs permission to list Slack channels.");
      throw new Error(typeof json.error === "string" ? json.error : "Slack couldn't list channels.");
    }
    for (const c of (json.channels ?? []) as { id?: string; name?: string }[]) {
      if (c.id && c.name) channels.push({ id: c.id, name: c.name });
    }
    cursor = json.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

// Posts `text` (Slack mrkdwn) to a public channel. chat:write.public lets
// the Anchor app post without being invited to the channel first.
// Returns a link to the message when Slack gives one.
export async function postSlackChannelMessage(
  userId: string,
  params: { channelId: string; text: string }
): Promise<{ permalink: string | null }> {
  const connection = await postingConnection(userId);
  let posted: Record<string, unknown>;
  try {
    posted = await slackCall(connection.accessToken, "chat.postMessage", {
      channel: params.channelId,
      text: params.text,
      unfurl_links: false,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "missing_scope") {
      throw new NeedsSlackPermissionError("Anchor needs permission to post in Slack channels.");
    }
    throw err;
  }
  const res = await fetch(
    `https://slack.com/api/chat.getPermalink?channel=${encodeURIComponent(params.channelId)}&message_ts=${encodeURIComponent(
      String(posted.ts ?? "")
    )}`,
    { headers: { Authorization: `Bearer ${connection.accessToken}` } }
  );
  const link = await res.json().catch(() => ({}));
  return { permalink: link.ok === true && typeof link.permalink === "string" ? link.permalink : null };
}
