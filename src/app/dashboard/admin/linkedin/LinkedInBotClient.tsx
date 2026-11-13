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
  zapierWebhookUrl: string;
  ctaUrl: string;
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
  viaZapier: boolean;
  canPost: boolean;
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
            {state.viaZapier
              ? "Posting to the Anchor.AI Page through Zapier"
              : state.connected
                ? `Posting as ${state.orgName}`
                : "Not set up to post yet"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {state.canPost
              ? `1 post a day at ${state.settings.postTimes[0]}; on ${DAYS[state.settings.videoDay]}s the video at ${state.settings.videoTime} is that day's post (${tz}).`
              : "Connect Zapier below so the bot can post."}
            {expiresSoon && !state.viaZapier && ` The LinkedIn connection runs out ${when(state.tokenExpiresAt, tz)}: reconnect before then.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.canPost && (
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
          )}
          {state.connected && !state.viaZapier ? (
            <>
              <a href="/api/admin/linkedin-bot/connect" className={btn}>
                Reconnect
              </a>
              <button onClick={disconnect} className={btn}>
                Disconnect
              </button>
            </>
          ) : (
            state.configured &&
            !state.viaZapier && (
              <a href="/api/admin/linkedin-bot/connect" className={btn}>
                Connect LinkedIn Page directly
              </a>
            )
          )}
        </div>
      </section>

      <ZapierPanel state={state} refresh={refresh} />
      {!state.configured && !state.viaZapier && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">Or post directly through LinkedIn&apos;s API (needs LinkedIn&apos;s approval)</summary>
          <div className="mt-3">
            <SetupSteps callbackUrl={callbackUrl} />
          </div>
        </details>
      )}

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
          <a href={`/api/admin/linkedin-bot/items/${item.id}/video?download`} className={`${btn} self-start`}>
            Download video
          </a>
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
        Every morning the bot finds 3 fresh posts in your space and writes the comments. LinkedIn doesn&apos;t allow
        comments to be posted automatically (it restricts Pages that do), so posting is one click each: <b>Copy &amp; open
        post</b>, paste, done. About a minute a day.
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Today&apos;s comments ({comments.length})</h2>
        {comments.length === 0 && (
          <p className={`${card} text-sm text-slate-500`}>
            Today&apos;s 3 are found each morning with the day&apos;s posts. You can also paste any post below.
          </p>
        )}
        {comments.map((c) => (
          <CommentDraft key={c.id} item={c} act={act} />
        ))}
      </section>

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
        <h2 className="text-sm font-semibold text-slate-900">Comment on another post</h2>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Post link (… → Copy link to post)" className={input} />
        <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Who posted it (company or person)" className={input} />
        <textarea value={postText} onChange={(e) => setPostText(e.target.value)} rows={5} placeholder="Paste the post's text" className={input} />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button onClick={draft} disabled={working || postText.trim().length < 20} className={`${btnPrimary} self-start`}>
          {working ? "Writing…" : "Write 3 comments"}
        </button>
      </section>

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
          Daily post time (24h)
          <input
            value={s.postTimes[0] ?? ""}
            onChange={(e) => setS({ ...s, postTimes: [e.target.value.trim()] })}
            placeholder="09:00"
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
        Sign-up link in every post (leave empty for Anchor&apos;s sign-up page)
        <input
          value={s.ctaUrl}
          onChange={(e) => setS({ ...s, ctaUrl: e.target.value })}
          placeholder="https://…/sign-up"
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        About the company (keeps the posts accurate)
        <textarea rows={4} value={s.about} onChange={(e) => setS({ ...s, about: e.target.value })} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Companies and people to engage with (one per line; leave empty and the bot suggests some each day)
        <textarea rows={5} value={s.watchlist.join("\n")} onChange={(e) => setS({ ...s, watchlist: lines(e.target.value) })} className={input} />
      </label>
      <button
        // The on/off switch and the Zapier link are saved where they're
        // shown; leave them out so an older copy here can't undo them.
        onClick={() => {
          const rest: Partial<Settings> = { ...s };
          delete rest.enabled;
          delete rest.zapierWebhookUrl;
          void save(rest);
        }}
        disabled={saving}
        className={`${btnPrimary} self-start`}
      >
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
          create an app named “Anchor.AI Page bot” and link it to the Anchor.AI company Page.
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

function ZapierPanel({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const [url, setUrl] = useState(state.settings.zapierWebhookUrl);
  const [open, setOpen] = useState(!state.viaZapier);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  async function save(value: string) {
    setWorking("save");
    setMsg(null);
    const res = await fetch("/api/admin/linkedin-bot", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { zapierWebhookUrl: value } }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) setMsg({ ok: false, text: "Couldn't save." });
    else if (value && !body?.settings?.zapierWebhookUrl) setMsg({ ok: false, text: "That doesn't look like a webhook link (it should start with https://hooks.zapier.com/)." });
    else setMsg({ ok: true, text: value ? "Saved. Now send a sample so Zapier can see the fields." : "Zapier disconnected." });
    setWorking(null);
    await refresh();
  }

  async function sample() {
    setWorking("sample");
    setMsg(null);
    const res = await fetch("/api/admin/linkedin-bot/zapier-test", { method: "POST" }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setMsg(res?.ok ? { ok: true, text: "Sample sent. In Zapier, click “Test trigger” to see it." } : { ok: false, text: body?.error ?? "Couldn't reach Zapier." });
    setWorking(null);
  }

  return (
    <section className={`${card} flex flex-col gap-3`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Post through Zapier {state.viaZapier && <span className="ml-2 text-xs font-medium text-emerald-700">Connected</span>}
        </h2>
        <button onClick={() => setOpen(!open)} className="text-xs font-medium text-brand">
          {open ? "Hide steps" : "Show steps"}
        </button>
      </div>
      {open && (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>
            In <a className="text-brand" href="https://zapier.com/app/zaps" target="_blank" rel="noreferrer">Zapier</a>, click <b>Create → Zap</b>.
          </li>
          <li>
            Trigger: <b>Webhooks by Zapier</b> → <b>Catch Hook</b>. Copy the webhook URL it gives you, paste it below and click Save.
          </li>
          <li>Click <b>Send a sample</b> below, then <b>Test trigger</b> in Zapier.</li>
          <li>
            Action: <b>LinkedIn</b> → <b>Create Company Update</b>. Sign in to LinkedIn, pick <b>Anchor.AI</b> as the company, set
            Visibility to <b>Anyone</b>, and map <b>Comment</b> → <code className="rounded bg-slate-100 px-1">text</code> and{" "}
            <b>Image URL</b> → <code className="rounded bg-slate-100 px-1">image_url</code>.
          </li>
          <li>
            Skip Zapier&apos;s test step (it would post on LinkedIn), click <b>Publish</b>, then turn <b>Bot on</b> above.
          </li>
        </ol>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.zapier.com/hooks/catch/…"
          className={`${input} min-w-[280px] flex-1`}
        />
        <button onClick={() => save(url.trim())} disabled={!!working || url.trim() === state.settings.zapierWebhookUrl} className={btnPrimary}>
          {working === "save" ? "Saving…" : "Save"}
        </button>
        <button onClick={sample} disabled={!!working || !state.settings.zapierWebhookUrl} className={btn}>
          {working === "sample" ? "Sending…" : "Send a sample"}
        </button>
        {state.viaZapier && (
          <button
            onClick={() => {
              setUrl("");
              void save("");
            }}
            disabled={!!working}
            className={btn}
          >
            Remove
          </button>
        )}
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      <p className="text-xs text-slate-500">
        The weekly video goes through Zapier as its cover image with the caption. To post the video itself, use{" "}
        <b>Download video</b> on it and upload it on LinkedIn, or map <code className="rounded bg-slate-100 px-1">video_url</code> if
        your Zap&apos;s LinkedIn step offers a video field.
      </p>
    </section>
  );
}
