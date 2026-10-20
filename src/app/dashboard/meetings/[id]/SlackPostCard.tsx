"use client";

import { useEffect, useRef, useState } from "react";
import { stashPendingGoogleAction, takePendingGoogleAction } from "@/lib/pendingGoogleAction";

type Channel = { id: string; name: string };
type Pending = { step: "prepare" } | { step: "post"; channelId: string; text: string };

// The channel last posted to, per deal, so the next call's recap goes to
// the same place by default.
function channelKey(dealId: string | null) {
  return `anchor.slackChannel.${dealId ?? "none"}`;
}

// "Post to Slack" on a meeting recap: Anchor drafts a short recap message,
// they pick a channel and edit it, and nothing is posted until they click.
export function SlackPostCard({ meetingId, dealId }: { meetingId: string; dealId: string | null }) {
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [channelId, setChannelId] = useState("");
  const [text, setText] = useState("");
  const [posted, setPosted] = useState<{ name: string; permalink: string | null } | null>(null);

  // Back from granting Slack permission: carry on where they left off.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = takePendingGoogleAction<Pending>("slack", meetingId);
    if (pending?.step === "prepare") queueMicrotask(() => void prepare(true));
    else if (pending?.step === "post") queueMicrotask(() => void post(pending.channelId, pending.text, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // A 403 with connectUrl means Slack needs one more permission. The first
  // time, send them to grant it; straight after a grant, it means they
  // declined, so say so instead of looping.
  function needsPermission(body: { connectUrl?: string }, pending: Pending, afterPermission: boolean): boolean {
    if (!body.connectUrl) return false;
    if (afterPermission) throw new Error("Anchor needs permission to post in Slack. Click again and allow it on Slack's screen.");
    stashPendingGoogleAction("slack", meetingId, pending);
    window.location.href = body.connectUrl;
    return true;
  }

  async function prepare(afterPermission = false) {
    setLoading(true);
    setError(null);
    setPosted(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/slack-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare" }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && needsPermission(body, { step: "prepare" }, afterPermission)) return;
      if (!res.ok) throw new Error(body.error || "Couldn't load your Slack channels");
      const list: Channel[] = body.channels ?? [];
      let remembered = "";
      try {
        remembered = localStorage.getItem(channelKey(dealId)) ?? "";
      } catch {}
      setChannels(list);
      setChannelId(list.some((c) => c.id === remembered) ? remembered : "");
      setText(body.text ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your Slack channels");
    } finally {
      setLoading(false);
    }
  }

  async function post(toChannel: string, message: string, afterPermission = false) {
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/slack-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "post", channelId: toChannel, text: message }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && needsPermission(body, { step: "post", channelId: toChannel, text: message }, afterPermission)) return;
      if (!res.ok) throw new Error(body.error || "Couldn't post to Slack");
      try {
        localStorage.setItem(channelKey(dealId), toChannel);
      } catch {}
      const name = channels?.find((c) => c.id === toChannel)?.name ?? "Slack";
      setPosted({ name, permalink: body.permalink ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post to Slack");
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-slate-900">Post to Slack</h2>
          <p className="mt-1 text-xs text-slate-500">
            Share this call&apos;s recap and next steps in a channel. Nothing is posted until you click Post.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={loading}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-dark disabled:opacity-50"
        >
          {loading ? "Loading…" : channels ? "Start over" : "Draft a Slack post"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {channels && (
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Channel</label>
            <select
              value={channelId}
              onChange={(e) => {
                setChannelId(e.target.value);
                setPosted(null);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">Choose a channel…</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Message</label>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPosted(null);
              }}
              rows={10}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            {posted ? (
              posted.permalink ? (
                <a
                  href={posted.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700"
                >
                  Posted to #{posted.name} ↗
                </a>
              ) : (
                <span className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">Posted to #{posted.name}</span>
              )
            ) : (
              <button
                type="button"
                onClick={() => void post(channelId, text)}
                disabled={posting || !channelId || !text.trim()}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
              >
                {posting ? "Posting…" : "Post"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
