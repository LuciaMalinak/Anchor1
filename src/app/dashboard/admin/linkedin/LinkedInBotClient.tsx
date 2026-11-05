"use client";

import { useCallback, useEffect, useState } from "react";

type Settings = {
  enabled: boolean;
  timeZone: string;
  postTimes: string[];
  videoDay: number;
  videoTime: string;
  topics: string[];
  about: string;
  watchlist: string[];
};

type Item = {
  id: string;
  kind: "post" | "video" | "comment";
  status: string;
  scheduledFor: string | null;
  topic: string | null;
  text: string;
  extra: {
    title?: string;
    slides?: { title: string; body: string }[];
    options?: string[];
    url?: string;
    author?: string;
    postText?: string;
  } | null;
  linkedinUrn: string | null;
  error: string | null;
  postedAt: string | null;
  createdAt: string;
};

type Target = { name: string; why: string; angle: string };

type State = {
  configured: boolean;
  connected: boolean;
  orgName: string | null;
  tokenExpiresAt: string | null;
  canRefresh: boolean;
  tokenExpiresSoon: boolean;
  settings: Settings;
  lastPlannedOn: string | null;
  lastError: string | null;
  engagement: { date?: string; targets?: Target[] } | null;
  items: Item[];
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const ERRORS: Record<string, string> = {
  not_configured: "The LinkedIn app isn't set up on the server yet (see the steps below).",
  state: "The LinkedIn sign-in didn't match. Try connecting again.",
  no_page: "That LinkedIn account isn't an admin of any company Page.",
};

// LinkedIn sends its error text HTML-escaped (&quot;…&quot;). The usual
// one at first: the app in LINKEDIN_PAGE_CLIENT_ID doesn't have the
// Community Management API product (yet), so it can't ask to post as a Page.
function explainError(raw: string): string {
  if (ERRORS[raw]) return ERRORS[raw];
  const text = raw
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  if (/scope .*not authorized for your application/i.test(text)) {
    return `LinkedIn says: ${text}. The app set in LINKEDIN_PAGE_CLIENT_ID doesn't have the "Community Management API" product approved yet. In linkedin.com/developers, open that app → Products and check Community Management API shows as approved (not pending), and that Render's keys are from this app, not the sign-in app. Then click Connect again.`;
  }
  return text;
}

function when(iso: string | null, tz: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function postLink(urn: string | null) {
  return urn ? `https://www.linkedin.com/feed/update/${urn}/` : null;
}

function searchLink(name: string) {
  return `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(name)}&sortBy=%22date_posted%22`;
}

const card = "rounded-xl border border-slate-200 bg-white p-5";
const btn = "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const btnPrimary = "rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50";
const input = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none";

export function LinkedInBotClient({
  initialError,
  justConnected,
  callbackUrl,
}: {
  initialError: string | null;
  justConnected: boolean;
  callbackUrl: string;
}) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(initialError ? explainError(initialError) : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"queue" | "comments" | "settings">("queue");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/linkedin-bot").catch(() => null);
    if (res?.ok) setState(await res.json());
  }, []);

  useEffect(() => {
    async function load() {
      await refresh();
    }
    void load();
    const poll = setInterval(() => void load(), 30_000);
    return () => clearInterval(poll);
  }, [refresh]);

  async function act(id: string, action: string, extra: Record<string, unknown> = {}) {
    setBusy(`${id}:${action}`);
    setError(null);
    const res = await fetch(`/api/admin/linkedin-bot/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) setError(body?.error ?? "That didn't work. Try again.");
    else if (body?.item?.status === "scheduled" && action === "post") setError(`Posting failed: ${body.item.error}`);
    setBusy(null);
    await refresh();
  }

  async function saveSettings(patch: Partial<Settings>) {
    setBusy("settings");
    const res = await fetch("/api/admin/linkedin-bot", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: patch }),
    }).catch(() => null);
    if (!res?.ok) setError("Couldn't save the settings.");
    setBusy(null);
    await refresh();
  }

  async function writeAgain() {
    setBusy("plan");
    setError(null);
    const res = await fetch("/api/admin/linkedin-bot/plan", { method: "POST" }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) setError(body?.error ?? "Couldn't write the posts.");
    setBusy(null);
    await refresh();
  }

  async function disconnect() {
    if (!confirm("Disconnect the LinkedIn Page? Nothing will be posted until you connect it again.")) return;
    await fetch("/api/admin/linkedin-bot", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disconnect: true }),
    });
    await refresh();
  }

  if (!state) return <p className="text-sm text-slate-500">Loading…</p>;
  const tz = state.settings.timeZone;
  const upcoming = state.items
    .filter((i) => i.kind !== "comment" && ["scheduled", "posting", "failed"].includes(i.status))
    .sort((a, b) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""));
  const posted = state.items.filter((i) => i.kind !== "comment" && i.status === "posted");
  const comments = state.items.filter((i) => i.kind === "comment" && i.status === "draft");
  const expiresSoon = state.tokenExpiresSoon;

  return (
    <div className="flex flex-col gap-6">
      {justConnected && state.connected && (
        <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Connected to {state.orgName}. Turn the bot on below when you&apos;re ready.
        </p>
      )}
      {(error || state.lastError) && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error ?? state.lastError}</p>
      )}

      <section className={`${card} flex flex-wrap items-center justify-between gap-4`}>
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {state.connected ? `Posting as ${state.orgName}` : "LinkedIn Page not connected"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {state.connected
              ? `${state.settings.postTimes.length} posts a day at ${state.settings.postTimes.join(" and ")}, video every ${DAYS[state.settings.videoDay]} at ${state.settings.videoTime} (${tz}).`
              : "Connect the AI Anchor Page so the bot can post."}
            {expiresSoon && ` The LinkedIn connection runs out ${when(state.tokenExpiresAt, tz)}: reconnect before then.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.connected ? (
            <>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={state.settings.enabled}
                  disabled={busy === "settings"}
                  onChange={(e) => saveSettings({ enabled: e.target.checked })}
                  className="h-4 w-4 accent-[var(--brand)]"
                />
                Bot on
              </label>
              <a href="/api/admin/linkedin-bot/connect" className={btn}>
                Reconnect
              </a>
              <button onClick={disconnect} className={btn}>
                Disconnect
              </button>
            </>
          ) : (
            <a
              href="/api/admin/linkedin-bot/connect"
              className={`${btnPrimary} ${state.configured ? "" : "pointer-events-none opacity-50"}`}
            >
              Connect LinkedIn Page
            </a>
          )}
        </div>
      </section>

      {!state.configured && <SetupSteps callbackUrl={callbackUrl} />}

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["queue", `Posts (${upcoming.length} coming up)`],
            ["comments", "Comments"],
            ["settings", "Settings"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === key ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "queue" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              The bot writes the day&apos;s posts each morning and publishes them at their times. Edit or skip anything
              before it goes out.
            </p>
            <button onClick={writeAgain} disabled={busy === "plan"} className={btn}>
              {busy === "plan" ? "Writing… (about a minute)" : "Write today's posts again"}
            </button>
          </div>
          {upcoming.length === 0 && (
            <p className={`${card} text-sm text-slate-500`}>
              {state.settings.enabled
                ? "Nothing waiting. Tomorrow's posts are written in the morning, or click “Write today's posts again”."
                : "Nothing scheduled. Turn the bot on, or click “Write today's posts again” to see drafts now."}
            </p>
          )}
          {upcoming.map((item) => (
            <QueueItem key={item.id} item={item} tz={tz} busy={busy} act={act} />
          ))}

          {posted.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="mt-4 text-sm font-semibold text-slate-900">Posted (last 2 weeks)</h2>
              {posted.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 bg-white px-4 py-2">
                  <p className="truncate text-sm text-slate-700">
                    <span className="mr-2 text-xs text-slate-400">{when(item.postedAt, tz)}</span>
                    {item.kind === "video" ? "Video · " : ""}
                    {item.text.split("\n")[0]}
                  </p>
                  {postLink(item.linkedinUrn) && (
                    <a href={postLink(item.linkedinUrn)!} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium text-brand">
                      View
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "comments" && <CommentsTab state={state} comments={comments} act={act} refresh={refresh} />}

      {tab === "settings" && <SettingsForm settings={state.settings} saving={busy === "settings"} save={saveSettings} />}
    </div>
  );
}

function QueueItem({
  item,
  tz,
  busy,
  act,
}: {
  item: Item;
  tz: string;
  busy: string | null;
  act: (id: string, action: string, extra?: Record<string, unknown>) => Promise<void>;
}) {
  const [text, setText] = useState(item.text);
  const [showVideo, setShowVideo] = useState(false);
  const dirty = text !== item.text;
  const isBusy = (a: string) => busy === `${item.id}:${a}`;
  return (
    <div className={`${card} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {item.kind === "video" ? "Weekly video" : "Post"}
          {item.topic ? ` · ${item.topic}` : ""}
        </p>
        <p className="text-xs text-slate-500">
          {item.status === "failed" ? (
            <span className="text-red-600">Failed: {item.error}</span>
          ) : item.status === "posting" ? (
            "Posting now…"
          ) : (
            <>
              Goes out {when(item.scheduledFor, tz)}
              {item.error && <span className="ml-2 text-amber-600">(retrying: {item.error})</span>}
            </>
          )}
        </p>
      </div>
      {item.kind === "video" && item.extra?.slides && (
        <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-600">{item.extra.title}</p>
          <ol className="list-decimal pl-5 text-xs text-slate-600">
            {item.extra.slides.map((s, i) => (
              <li key={i}>
                <b>{s.title}</b> {s.body}
              </li>
            ))}
          </ol>
          {showVideo ? (
            <video src={`/api/admin/linkedin-bot/items/${item.id}/video`} controls autoPlay className="w-72 rounded-lg" />
          ) : (
            <button onClick={() => setShowVideo(true)} className={`${btn} self-start`}>
              Preview video
            </button>
          )}
        </div>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(14, text.split("\n").length + 2)} className={input} />
      <div className="flex flex-wrap gap-2">
        {dirty && (
          <button onClick={() => act(item.id, "edit", { text })} disabled={!!busy} className={btnPrimary}>
            Save changes
          </button>
        )}
        <button
          onClick={async () => {
            if (dirty) await act(item.id, "edit", { text });
            if (confirm("Post this to LinkedIn now?")) await act(item.id, "post");
          }}
          disabled={!!busy || item.status === "posting"}
          className={btn}
        >
          {isBusy("post") ? "Posting…" : "Post now"}
        </button>
        <button onClick={() => act(item.id, "skip")} disabled={!!busy || item.status === "posting"} className={btn}>
          Skip
        </button>
      </div>
    </div>
  );
}

function CommentsTab({
  state,
  comments,
  act,
  refresh,
}: {
  state: State;
  comments: Item[];
  act: (id: string, action: string, extra?: Record<string, unknown>) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [author, setAuthor] = useState("");
  const [postText, setPostText] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const targets = state.engagement?.targets ?? [];

  async function draft() {
    setWorking(true);
    setErr(null);
    const res = await fetch("/api/admin/linkedin-bot/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, author, postText }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) setErr(body?.error ?? "Couldn't write comments.");
    else {
      setUrl("");
      setAuthor("");
      setPostText("");
    }
    setWorking(false);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-slate-500">
        LinkedIn doesn&apos;t allow bots to comment on other companies&apos; posts, so the bot does the thinking and you
        post: open a company&apos;s latest posts, paste one in, pick a comment, and it&apos;s copied for you.
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Today&apos;s companies to engage with{state.engagement?.date ? ` · ${state.engagement.date}` : ""}
        </h2>
        {targets.length === 0 && (
          <p className={`${card} text-sm text-slate-500`}>The list is made each morning with the day&apos;s posts.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {targets.map((t) => (
            <div key={t.name} className={`${card} flex flex-col gap-1`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                <a href={searchLink(t.name)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand">
                  Their latest posts ↗
                </a>
              </div>
              <p className="text-xs text-slate-500">{t.why}</p>
              <p className="text-xs text-slate-700">
                <b>Angle:</b> {t.angle}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className={`${card} flex flex-col gap-3`}>
        <h2 className="text-sm font-semibold text-slate-900">Write a comment</h2>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Post link (… → Copy link to post)" className={input} />
        <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Who posted it (company or person)" className={input} />
        <textarea value={postText} onChange={(e) => setPostText(e.target.value)} rows={5} placeholder="Paste the post's text" className={input} />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button onClick={draft} disabled={working || postText.trim().length < 20} className={`${btnPrimary} self-start`}>
          {working ? "Writing…" : "Write 3 comments"}
        </button>
      </section>

      {comments.map((c) => (
        <CommentDraft key={c.id} item={c} act={act} />
      ))}
    </div>
  );
}

function CommentDraft({ item, act }: { item: Item; act: (id: string, action: string, extra?: Record<string, unknown>) => Promise<void> }) {
  const [copied, setCopied] = useState<number | null>(null);
  const options = item.extra?.options ?? [item.text];
  async function use(text: string, i: number) {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(i);
    if (item.extra?.url) window.open(item.extra.url, "_blank", "noopener");
  }
  return (
    <div className={`${card} flex flex-col gap-3`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">On {item.extra?.author || "a post"}</p>
        <p className="line-clamp-1 max-w-md text-xs text-slate-400">{item.extra?.postText}</p>
      </div>
      {options.map((o, i) => (
        <div key={i} className="flex items-start justify-between gap-4 rounded-lg bg-slate-50 p-3">
          <p className="text-sm text-slate-800">{o}</p>
          <button onClick={() => use(o, i)} className={`${btn} shrink-0`}>
            {copied === i ? "Copied ✓" : item.extra?.url ? "Copy & open post" : "Copy"}
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={() => act(item.id, "done", { text: copied !== null ? options[copied] : "" })} className={btn}>
          I posted it
        </button>
        <button onClick={() => act(item.id, "skip")} className={btn}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function SettingsForm({ settings, saving, save }: { settings: Settings; saving: boolean; save: (s: Partial<Settings>) => Promise<void> }) {
  const [s, setS] = useState(settings);
  const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <div className={`${card} flex flex-col gap-4`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Post times (one per line, 24h)
          <textarea
            rows={2}
            value={s.postTimes.join("\n")}
            onChange={(e) => setS({ ...s, postTimes: lines(e.target.value) })}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Time zone
          <input value={s.timeZone} onChange={(e) => setS({ ...s, timeZone: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Video day
          <select value={s.videoDay} onChange={(e) => setS({ ...s, videoDay: Number(e.target.value) })} className={input}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Video time (24h)
          <input value={s.videoTime} onChange={(e) => setS({ ...s, videoTime: e.target.value })} className={input} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Topics (one per line; the bot rotates through them)
        <textarea rows={4} value={s.topics.join("\n")} onChange={(e) => setS({ ...s, topics: lines(e.target.value) })} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        About the company (keeps the posts accurate)
        <textarea rows={4} value={s.about} onChange={(e) => setS({ ...s, about: e.target.value })} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Companies and people to engage with (one per line; leave empty and the bot suggests some each day)
        <textarea rows={5} value={s.watchlist.join("\n")} onChange={(e) => setS({ ...s, watchlist: lines(e.target.value) })} className={input} />
      </label>
      <button onClick={() => save(s)} disabled={saving} className={`${btnPrimary} self-start`}>
        {saving ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}

function SetupSteps({ callbackUrl }: { callbackUrl: string }) {
  return (
    <section className={`${card} flex flex-col gap-2 text-sm text-slate-700`}>
      <h2 className="font-semibold text-slate-900">One-time setup on LinkedIn</h2>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Go to <a className="text-brand" href="https://www.linkedin.com/developers/apps/new" target="_blank" rel="noreferrer">linkedin.com/developers/apps/new</a>,
          create an app named “AI Anchor Page bot” and link it to the AI Anchor company Page.
        </li>
        <li>Verify the app from the Page (Settings → Verify), then under Products request <b>Community Management API</b>.</li>
        <li>
          Under Auth, add the redirect URL <code className="rounded bg-slate-100 px-1">{callbackUrl}</code>.
        </li>
        <li>
          In Render, set <code className="rounded bg-slate-100 px-1">LINKEDIN_PAGE_CLIENT_ID</code> and{" "}
          <code className="rounded bg-slate-100 px-1">LINKEDIN_PAGE_CLIENT_SECRET</code> from the app&apos;s Auth tab, then come back
          and click Connect.
        </li>
      </ol>
    </section>
  );
}
