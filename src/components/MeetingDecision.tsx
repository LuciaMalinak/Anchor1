"use client";

import { useState } from "react";

type Target = "google" | "apple" | "both";

// A meeting someone suggested by email (from the Morning brief): Approve
// or Decline, and on Approve, which calendar — Google Calendar, Apple
// Calendar (a calendar file, which opens it on a Mac, iPhone or iPad) or
// both. Nothing reaches a calendar until it's chosen here. Used on the
// brief page and in the pop-ups across Anchor.
export function MeetingDecision({
  token,
  threadId,
  fromName,
  title,
  when,
  initial,
  compact,
  onDone,
}: {
  token?: string;
  threadId: string;
  fromName: string;
  title: string;
  when: string;
  initial?: "added" | "declined" | null;
  compact?: boolean;
  onDone?: (result: "added" | "declined") => void;
}) {
  const [state, setState] = useState<"ask" | "choose" | "working" | "added" | "declined">(initial ?? "ask");
  const [invite, setInvite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const first = fromName.split(" ")[0];

  const icsUrl = `/api/morning-brief/calendar/ics?threadId=${encodeURIComponent(threadId)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/morning-brief/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, threadId, ...body }),
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

  async function add(target: Target) {
    setState("working");
    setError(null);
    if (target !== "apple") {
      const { ok, json } = await post({ action: "google", invite });
      if (!ok) {
        setState("choose");
        if (json.error === "needs_google_permission" && json.connectUrl) {
          setConnectUrl(json.connectUrl);
          setError("Anchor needs permission to add events to your Google Calendar.");
        } else setError(json.error || "Couldn't add it. Try again.");
        return;
      }
      setOpenUrl(json.openUrl ?? null);
    }
    if (target !== "google") {
      // The calendar file: opening it adds the event to Apple Calendar.
      const link = document.createElement("a");
      link.href = icsUrl;
      link.download = "meeting.ics";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setState("added");
    onDone?.("added");
  }

  const box = compact ? "" : "mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5";
  const btn = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60";
  return (
    <div className={box}>
      <p className="text-sm text-sky-900">
        <span className="font-semibold">{first} suggested: </span>
        {title} · {when}
      </p>
      {state === "added" && (
        <p className="mt-1.5 text-sm font-medium text-emerald-700">
          Added to your calendar ✓{" "}
          {openUrl && (
            <a href={openUrl} target="_blank" rel="noreferrer" className="underline">
              Open it
            </a>
          )}
        </p>
      )}
      {state === "declined" && <p className="mt-1.5 text-sm text-slate-500">Declined — not added.</p>}
      {(state === "ask" || (state === "working" && !connectUrl)) && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => setState("choose")} disabled={state === "working"} className={`${btn} bg-sky-700 text-white hover:bg-sky-800`}>
            Approve
          </button>
          <button
            type="button"
            onClick={decline}
            disabled={state === "working"}
            className={`${btn} border border-slate-300 bg-white text-slate-700 hover:border-slate-400`}
          >
            Decline
          </button>
        </div>
      )}
      {state === "choose" && (
        <div className="mt-2">
          <p className="text-xs text-sky-900">Add it to:</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <button type="button" onClick={() => add("google")} className={`${btn} bg-sky-700 text-white hover:bg-sky-800`}>
              Google Calendar
            </button>
            <button type="button" onClick={() => add("apple")} className={`${btn} bg-sky-700 text-white hover:bg-sky-800`}>
              Apple / iPhone
            </button>
            <button type="button" onClick={() => add("both")} className={`${btn} border border-sky-700 bg-white text-sky-800 hover:bg-sky-100`}>
              Both
            </button>
          </div>
          <label className="mt-2 flex items-center gap-1.5 text-xs text-sky-900">
            <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
            Send {first} a Google invite
          </label>
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-sm text-red-600">
          {error}{" "}
          {connectUrl && (
            <a href={connectUrl} className="font-semibold underline">
              Allow it
            </a>
          )}
        </p>
      )}
    </div>
  );
}
