"use client";

import { useState } from "react";

type Suggestion = {
  title: string;
  startISO: string;
  durationMinutes: number;
  attendees: string[];
  sourceQuote: string;
  confidence: "high" | "medium";
};
type ItemState = "idle" | "adding" | "added" | "dismissed";

function formatWhen(startISO: string, minutes: number) {
  // startISO is wall time in the browser's own time zone (sent with the
  // request), so parsing it as local time is correct here.
  const start = new Date(startISO);
  const end = new Date(start.getTime() + minutes * 60_000);
  const day = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time(start)}–${time(end)}`;
}

// Follow-up meetings agreed in the call, each one a click away from the
// user's Google Calendar. Asks for Calendar permission on first use.
export function SuggestedInvites({ meetingId }: { meetingId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [timeZone, setTimeZone] = useState("UTC");
  const [itemState, setItemState] = useState<Record<number, ItemState>>({});
  const [itemError, setItemError] = useState<Record<number, string>>({});
  const [sendInvites, setSendInvites] = useState(true);

  async function handleFind() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/suggested-invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseBody.error || "Couldn't look for follow-up meetings");
      setSuggestions(responseBody.suggestions);
      setTimeZone(responseBody.timeZone);
      setItemState({});
      setItemError({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't look for follow-up meetings");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(i: number) {
    const s = suggestions![i];
    setItemState((m) => ({ ...m, [i]: "adding" }));
    setItemError((m) => ({ ...m, [i]: "" }));
    try {
      const res = await fetch(`/api/meetings/${meetingId}/calendar-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...s, timeZone, sendInvites: sendInvites && s.attendees.length > 0 }),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (res.status === 403 && responseBody.connectUrl) {
        window.location.href = responseBody.connectUrl;
        return;
      }
      if (!res.ok) throw new Error(responseBody.error || "Couldn't add it to your calendar");
      setItemState((m) => ({ ...m, [i]: "added" }));
    } catch (err) {
      setItemError((m) => ({ ...m, [i]: err instanceof Error ? err.message : "Couldn't add it" }));
      setItemState((m) => ({ ...m, [i]: "idle" }));
    }
  }

  const visible = suggestions?.filter((_, i) => itemState[i] !== "dismissed") ?? [];
  const anyAttendees = visible.some((s) => s.attendees.length > 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-slate-900">Suggested invites</h2>
          <p className="mt-1 text-xs text-slate-500">
            Follow-up meetings people agreed to in this call. Nothing is added to your calendar until
            you click.
          </p>
        </div>
        <button
          type="button"
          onClick={handleFind}
          disabled={loading}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-dark disabled:opacity-50"
        >
          {loading ? "Looking…" : suggestions ? "Look again" : "Find follow-up meetings"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {suggestions && visible.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No follow-up meetings were agreed in this call.</p>
      )}
      {visible.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {suggestions!.map((s, i) =>
            itemState[i] === "dismissed" ? null : (
              <div key={i} className="rounded-lg bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{s.title}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatWhen(s.startISO, s.durationMinutes)}
                      {s.attendees.length > 0 && ` · ${s.attendees.join(", ")}`}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {s.confidence === "high" ? "Agreed in the call" : "Mentioned in the call"}
                  </span>
                </div>
                <p className="mt-2 text-sm italic text-slate-500">&ldquo;{s.sourceQuote}&rdquo;</p>
                {itemError[i] && <p className="mt-2 text-sm text-red-600">{itemError[i]}</p>}
                <div className="mt-3 flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setItemState((m) => ({ ...m, [i]: "dismissed" }))}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
                  >
                    Dismiss
                  </button>
                  {itemState[i] === "added" ? (
                    <span className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                      Added to calendar
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAdd(i)}
                      disabled={itemState[i] === "adding"}
                      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
                    >
                      {itemState[i] === "adding" ? "Adding…" : "Add to calendar"}
                    </button>
                  )}
                </div>
              </div>
            )
          )}
          {anyAttendees && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={sendInvites} onChange={(e) => setSendInvites(e.target.checked)} />
              Email the invite to attendees
            </label>
          )}
        </div>
      )}
    </section>
  );
}
