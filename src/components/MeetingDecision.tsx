"use client";

import { useState } from "react";

type Platform = "google_meet" | "zoom" | "teams" | "in_person";
type Option = { platform: Platform; label: string; available: boolean; connectUrl: string | null; note: string | null };
type Form = {
  title: string;
  start: string | null;
  durationMinutes: number;
  timeZone: string;
  attendees: { name: string; email: string }[];
  options: Option[];
};

const DURATIONS = [15, 30, 45, 60, 90];

// Tomorrow at 10:00, as "YYYY-MM-DDTHH:MM", when nobody proposed a time.
function defaultStart(): string {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T10:00`;
}

// A meeting someone asked for, by email (from the Morning brief) or in
// Slack: Set it up or Decline. Setting it up picks how to meet (Google
// Meet, Zoom, Teams or in person), the time, and who to invite (everyone
// on the thread, ticked), then Anchor creates it in the calendar and the
// calendar emails everyone the invitation (see /api/schedule-meeting).
// Used on the brief page and in the pop-ups across Anchor.
export function MeetingDecision({
  token,
  source = "email",
  threadId,
  fromName,
  title,
  when,
  initial,
  compact,
  onDone,
}: {
  token?: string;
  source?: "email" | "slack";
  // The Gmail thread id for an email, the proposal id for Slack.
  threadId: string;
  fromName: string;
  title: string;
  when: string;
  initial?: "added" | "declined" | null;
  compact?: boolean;
  onDone?: (result: "added" | "declined") => void;
}) {
  const [state, setState] = useState<"ask" | "loading" | "form" | "working" | "added" | "declined">(initial ?? "ask");
  const [form, setForm] = useState<Form | null>(null);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState(30);
  const [meetingTitle, setMeetingTitle] = useState(title);
  const [location, setLocation] = useState("");
  const [invitees, setInvitees] = useState<Record<string, boolean>>({});
  const [extra, setExtra] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [done, setDone] = useState<{ openUrl: string | null; joinUrl: string | null; invited: string[]; calendar: string } | null>(null);
  const first = fromName.split(/[ ,]/)[0];
  const returnTo = typeof window === "undefined" ? "/dashboard" : window.location.pathname + window.location.search;

  async function open() {
    setState("loading");
    setError(null);
    const params = new URLSearchParams({ source, id: threadId, returnTo, ...(token ? { token } : {}) });
    const res = await fetch(`/api/schedule-meeting?${params}`).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setState("ask");
      setError(json.error || "Couldn't open it. Try again.");
      return;
    }
    const f = json as Form;
    setForm(f);
    setMeetingTitle(f.title || title);
    setStart(f.start || defaultStart());
    setDuration(f.durationMinutes || 30);
    setInvitees(Object.fromEntries(f.attendees.map((a) => [a.email, true])));
    setPlatform(f.options.find((o) => o.available)?.platform ?? null);
    setState("form");
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/schedule-meeting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, source, id: threadId, returnTo, ...body }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    return { ok: Boolean(res?.ok), json };
  }

  async function decline() {
    setState("working");
    const { ok, json } = await post({ action: "decline" });
    if (ok) {
      setState("declined");
      onDone?.("declined");
    } else {
      setState("ask");
      setError(json.error || "Couldn't save that. Try again.");
    }
  }

  async function schedule() {
    if (!form || !platform) return;
    setState("working");
    setError(null);
    setConnectUrl(null);
    const extras = extra
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes("@"));
    const { ok, json } = await post({
      platform,
      title: meetingTitle,
      start,
      durationMinutes: duration,
      timeZone: form.timeZone,
      location,
      attendees: [...Object.entries(invitees).filter(([, on]) => on).map(([email]) => email), ...extras],
    });
    if (!ok) {
      setState("form");
      setError(json.error || "Couldn't set it up. Try again.");
      setConnectUrl(json.connectUrl ?? null);
      return;
    }
    setDone({ openUrl: json.openUrl ?? null, joinUrl: json.joinUrl ?? null, invited: json.invited ?? [], calendar: json.calendar });
    setState("added");
    onDone?.("added");
  }

  const box = compact ? "" : "mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5";
  const btn = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60";
  const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800";
  const [date, time] = start.split("T");
  const icsUrl = `/api/morning-brief/calendar/ics?threadId=${encodeURIComponent(threadId)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;

  return (
    <div className={box}>
      <p className="text-sm text-sky-900">
        <span className="font-semibold">{first} asked to meet: </span>
        {title} · {when}
      </p>

      {state === "added" && (
        <p className="mt-1.5 text-sm font-medium text-emerald-700">
          Set up ✓
          {done && (
            <>
              {" "}
              Invitation sent to {done.invited.length} {done.invited.length === 1 ? "person" : "people"} from your{" "}
              {done.calendar === "outlook" ? "Outlook" : "Google"} calendar.{" "}
              {done.joinUrl && (
                <a href={done.joinUrl} target="_blank" rel="noreferrer" className="underline">
                  Meeting link
                </a>
              )}{" "}
              {done.openUrl && (
                <a href={done.openUrl} target="_blank" rel="noreferrer" className="underline">
                  Open in calendar
                </a>
              )}
            </>
          )}
        </p>
      )}
      {state === "declined" && <p className="mt-1.5 text-sm text-slate-500">Declined — nothing was set up.</p>}

      {(state === "ask" || state === "loading") && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={open} disabled={state === "loading"} className={`${btn} bg-sky-700 text-white hover:bg-sky-800`}>
            {state === "loading" ? "Opening…" : "Set it up"}
          </button>
          <button
            type="button"
            onClick={decline}
            disabled={state === "loading"}
            className={`${btn} border border-slate-300 bg-white text-slate-700 hover:border-slate-400`}
          >
            Decline
          </button>
        </div>
      )}

      {(state === "form" || state === "working") && form && (
        <div className="mt-2 flex flex-col gap-2.5">
          <div>
            <p className="text-xs font-medium text-sky-900">How you&apos;ll meet</p>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {form.options.map((o) =>
                o.available ? (
                  <button
                    key={o.platform}
                    type="button"
                    onClick={() => setPlatform(o.platform)}
                    className={`rounded-md border px-2 py-1.5 text-left text-xs font-medium ${
                      platform === o.platform ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-sky-600"
                    }`}
                  >
                    {o.label}
                  </button>
                ) : (
                  <div key={o.platform} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-400">
                    {o.label}
                    {o.note && (
                      <span className="block text-[10px] font-normal">
                        {o.connectUrl ? (
                          <a href={o.connectUrl} className="text-sky-700 underline">
                            {o.note}
                          </a>
                        ) : (
                          o.note
                        )}
                      </span>
                    )}
                  </div>
                )
              )}
            </div>
          </div>

          <label className="text-xs font-medium text-sky-900">
            Title
            <input className={`${input} mt-0.5`} value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-xs font-medium text-sky-900">
              Day
              <input type="date" className={`${input} mt-0.5`} value={date ?? ""} onChange={(e) => setStart(`${e.target.value}T${time ?? "10:00"}`)} />
            </label>
            <label className="text-xs font-medium text-sky-900">
              Time
              <input type="time" step={300} className={`${input} mt-0.5`} value={time ?? ""} onChange={(e) => setStart(`${date}T${e.target.value}`)} />
            </label>
            <label className="col-span-2 text-xs font-medium text-sky-900">
              Length
              <select className={`${input} mt-0.5`} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[...new Set([...DURATIONS, duration])].sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="-mt-1 text-[11px] text-slate-500">Times are in {form.timeZone.replace(/_/g, " ")}.</p>

          {platform === "in_person" && (
            <label className="text-xs font-medium text-sky-900">
              Where
              <input className={`${input} mt-0.5`} placeholder="Address or place" value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
          )}

          <div>
            <p className="text-xs font-medium text-sky-900">Invite</p>
            {form.attendees.length === 0 && <p className="text-xs text-slate-500">No email addresses found; add them below.</p>}
            <div className="mt-1 flex flex-col gap-1">
              {form.attendees.map((a) => (
                <label key={a.email} className="flex items-center gap-1.5 text-xs text-slate-700">
                  <input type="checkbox" checked={invitees[a.email] ?? false} onChange={(e) => setInvitees((s) => ({ ...s, [a.email]: e.target.checked }))} />
                  <span className="truncate">
                    {a.name && a.name !== a.email ? `${a.name} · ` : ""}
                    {a.email}
                  </span>
                </label>
              ))}
            </div>
            <input className={`${input} mt-1.5`} placeholder="Add more emails" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={schedule}
              disabled={state === "working" || !platform || !date || !time}
              className={`${btn} bg-sky-700 text-white hover:bg-sky-800`}
            >
              {state === "working" ? "Setting it up…" : "Create & send invites"}
            </button>
            <button type="button" onClick={() => setState("ask")} disabled={state === "working"} className="text-xs text-slate-500 hover:text-slate-700">
              Back
            </button>
            {source === "email" && (
              <a href={icsUrl} download="meeting.ics" className="text-xs text-slate-500 underline hover:text-slate-700">
                Just add to Apple Calendar
              </a>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-1.5 text-sm text-red-600">
          {error}{" "}
          {connectUrl && (
            <a href={connectUrl} className="font-semibold underline">
              Connect it
            </a>
          )}
        </p>
      )}
    </div>
  );
}
