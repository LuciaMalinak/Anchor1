"use client";

import { useEffect, useMemo, useState } from "react";
import type { MorningBriefPrefs, BriefChannel } from "@/lib/morningBriefPrefs";

type Setup = {
  email: string | null;
  phone: string | null;
  smsReady: boolean;
  googleConfigured: boolean;
  googleConnected: boolean;
  gmailCanDraft: boolean;
  slackConnected: boolean;
};
type Status = { enabled: boolean; prefs: MorningBriefPrefs; lastSentOn: string | null; setup: Setup };

const TIMES = Array.from({ length: 48 }, (_, i) => ({ hour: Math.floor(i / 2), minute: (i % 2) * 30 })).filter(
  (t) => t.hour >= 5 && t.hour <= 12
);

function timeLabel(hour: number, minute: number) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${minute === 0 ? "00" : "30"} ${hour < 12 ? "am" : "pm"}`;
}

function zones(current: string): string[] {
  const all: string[] =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [current, "America/New_York", "Europe/London"];
  return all.includes(current) ? all : [current, ...all];
}

// The Morning brief section of the Profile page: on/off, when, where it
// goes, what's in it, how often to repeat an unanswered email, and
// "Send me one now".
export function MorningBriefSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [prefs, setPrefs] = useState<MorningBriefPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<{ text: string | null; note: string | null; channel: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/morning-brief")
      .then((r) => r.json())
      .then((s: Status) => {
        if (cancelled || !s?.prefs) return;
        // Never set up before: start from this browser's time zone.
        const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const firstTime = !s.enabled && !s.lastSentOn;
        setStatus(s);
        setEnabled(s.enabled);
        setPrefs(firstTime && browserZone ? { ...s.prefs, timeZone: browserZone } : s.prefs);
      })
      .catch(() => setError("Couldn't load your brief settings."));
    return () => {
      cancelled = true;
    };
  }, []);

  const zoneList = useMemo(() => (prefs ? zones(prefs.timeZone) : []), [prefs]);

  if (!prefs || !status) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-brand">Morning brief</h2>
        <p className="mt-2 text-sm text-slate-500">{error ?? "Loading…"}</p>
      </section>
    );
  }

  const setup = status.setup;
  const update = (patch: Partial<MorningBriefPrefs>) => {
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    setSaved(false);
  };
  const channelNote: Record<BriefChannel, string | null> = {
    email: setup.email ? `To ${setup.email}` : null,
    sms: !setup.phone
      ? "Add your phone number above first."
      : !setup.smsReady
        ? "Text messages aren't switched on for Anchor yet, so it'll come by email until they are."
        : `To ${setup.phone}`,
    slack: setup.slackConnected ? "As a Slack message to you" : "Connect Slack on the Integrations page first; until then it comes by email.",
  };

  async function save(nextEnabled = enabled) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/morning-brief", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled, prefs }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't save");
      setStatus(body);
      setEnabled(body.enabled);
      setPrefs(body.prefs);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function sendNow() {
    setSending(true);
    setError(null);
    setPreview(null);
    try {
      // Save first so it uses what's on screen.
      await save();
      const res = await fetch("/api/morning-brief/send-now", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't send it");
      setPreview({ text: body.text, note: body.note, channel: body.channel });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send it");
    } finally {
      setSending(false);
    }
  }

  const label = "text-xs font-medium text-slate-500";
  const select = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand";
  const check = "h-4 w-4 rounded border-slate-300 accent-[#12294a]";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-brand">Morning brief</h2>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            Every morning: the emails still waiting on your reply, summarized in a line each, plus today&apos;s meetings,
            your to-dos and deals going quiet. Unanswered emails keep coming back until you reply, mark them done or snooze
            them.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            className={check}
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              void save(e.target.checked);
            }}
          />
          {enabled ? "On" : "Off"}
        </label>
      </div>

      {!setup.googleConnected && setup.googleConfigured && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Connect Google on the{" "}
          <a href="/dashboard/integrations" className="font-semibold underline">
            Integrations page
          </a>{" "}
          so your brief can include the emails waiting on you and today&apos;s meetings.
        </p>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="mb-time" className={label}>
            Time
          </label>
          <select
            id="mb-time"
            className={select}
            value={`${prefs.hour}:${prefs.minute}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              update({ hour: h, minute: m === 30 ? 30 : 0 });
            }}
          >
            {TIMES.map((t) => (
              <option key={`${t.hour}:${t.minute}`} value={`${t.hour}:${t.minute}`}>
                {timeLabel(t.hour, t.minute)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor="mb-zone" className={label}>
            Time zone
          </label>
          <select id="mb-zone" className={select} value={prefs.timeZone} onChange={(e) => update({ timeZone: e.target.value })}>
            {zoneList.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="mb-days" className={label}>
            Days
          </label>
          <select id="mb-days" className={select} value={prefs.days} onChange={(e) => update({ days: e.target.value === "everyday" ? "everyday" : "weekdays" })}>
            <option value="weekdays">Weekdays</option>
            <option value="everyday">Every day</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor="mb-channel" className={label}>
            Send it by
          </label>
          <select
            id="mb-channel"
            className={select}
            value={prefs.channel}
            onChange={(e) => update({ channel: e.target.value as BriefChannel })}
          >
            <option value="email">Email</option>
            <option value="sms">Text message</option>
            <option value="slack">Slack</option>
          </select>
          {channelNote[prefs.channel] && <p className="text-xs text-slate-500">{channelNote[prefs.channel]}</p>}
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className={label}>Include</legend>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-700">
          {(
            [
              ["emails", "Emails waiting on my reply"],
              ["meetings", "Today's meetings"],
              ["tasks", "My to-dos"],
              ["quietDeals", "Deals going quiet"],
            ] as const
          ).map(([key, text]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                className={check}
                checked={prefs.include[key]}
                onChange={(e) => update({ include: { ...prefs.include, [key]: e.target.checked } })}
              />
              {text}
            </label>
          ))}
        </div>
      </fieldset>

      {prefs.include.emails && (
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="mb-scope" className={label}>
              Which emails
            </label>
            <select id="mb-scope" className={select} value={prefs.emailScope} onChange={(e) => update({ emailScope: e.target.value === "deals" ? "deals" : "all" })}>
              <option value="all">Anything that needs a reply</option>
              <option value="deals">Only from people on my deals</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="mb-remind" className={label}>
              Remind me again
            </label>
            <select
              id="mb-remind"
              className={select}
              value={prefs.remindEveryDays}
              onChange={(e) => update({ remindEveryDays: Number(e.target.value) === 2 ? 2 : Number(e.target.value) === 3 ? 3 : 1 })}
            >
              <option value={1}>Every day until answered</option>
              <option value={2}>Every 2 days</option>
              <option value={3}>Every 3 days</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="mb-lookback" className={label}>
              Look back
            </label>
            <select id="mb-lookback" className={select} value={prefs.lookbackDays} onChange={(e) => update({ lookbackDays: Number(e.target.value) === 7 ? 7 : 14 })}>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
            </select>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-3">
            <input type="checkbox" className={`${check} mt-0.5`} checked={prefs.draftReplies} onChange={(e) => update({ draftReplies: e.target.checked })} />
            <span>
              Draft replies for me
              <span className="block text-xs text-slate-500">
                Puts a suggested reply to the top 3 emails in your Gmail drafts, written the way you write. Nothing is sent.
                {prefs.draftReplies && !setup.gmailCanDraft && setup.googleConnected && (
                  <>
                    {" "}
                    <a
                      href="/api/integrations/google/connect?add=gmail_compose&returnTo=%2Fdashboard%2Fprofile"
                      className="font-semibold text-brand underline"
                    >
                      Allow Anchor to create Gmail drafts
                    </a>
                  </>
                )}
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => void sendNow()}
          disabled={sending || saving}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-brand hover:text-brand disabled:opacity-50"
        >
          {sending ? "Putting it together…" : "Send me one now"}
        </button>
        {saved && !sending && <span className="text-xs text-emerald-600">Saved ✓</span>}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {preview && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-600">
            {preview.text ? `Sent by ${preview.channel === "sms" ? "text" : preview.channel}.` : "Nothing to send right now."}
            {preview.note ? ` ${preview.note}` : ""}
          </p>
          {preview.text && <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-700">{preview.text}</pre>}
        </div>
      )}
    </section>
  );
}
