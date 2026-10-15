"use client";

import { useState } from "react";

// "Done" and "Snooze 3 days" for one email on the brief page. Clicking a
// link in the brief email only opens this page; nothing changes until a
// button here is pressed (link scanners in mail apps open links too).
export function BriefItemActions({
  token,
  threadId,
  initial,
  highlight,
}: {
  token: string;
  threadId: string;
  initial: "done" | "snoozed" | null;
  highlight: "done" | "snooze" | null;
}) {
  const [state, setState] = useState<"done" | "snoozed" | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "done" | "snooze") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/morning-brief/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, threadId, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't update that");
      setState(action === "done" ? "done" : "snoozed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that");
    } finally {
      setBusy(false);
    }
  }

  if (state) {
    return (
      <p className="text-sm font-medium text-emerald-700">
        {state === "done" ? "Done — no more reminders." : "Snoozed for 3 days."}
      </p>
    );
  }
  const ring = "ring-2 ring-accent ring-offset-2";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => act("done")}
        disabled={busy}
        className={`rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${highlight === "done" ? ring : ""}`}
      >
        Done
      </button>
      <button
        type="button"
        onClick={() => act("snooze")}
        disabled={busy}
        className={`rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 ${highlight === "snooze" ? ring : ""}`}
      >
        Snooze 3 days
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </div>
  );
}
