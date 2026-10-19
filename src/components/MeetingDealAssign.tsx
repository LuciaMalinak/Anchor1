"use client";

import { useState } from "react";

type DealOption = { id: string; name: string };

// For a meeting that isn't on a deal yet (Home's meeting list): add it to
// one of their deals, or create a new deal for it (named after the call,
// editable). Once it's on a deal, its summary, people and next steps file
// there.
export function MeetingDealAssign({
  meetingId,
  meetingTitle,
  deals,
  onAssigned,
}: {
  meetingId: string;
  meetingTitle: string;
  deals: DealOption[];
  onAssigned: (deal: DealOption) => void;
}) {
  const [mode, setMode] = useState<"idle" | "pick" | "create">("idle");
  const [name, setName] = useState(meetingTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign(dealId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealId }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError("Couldn't add it to that deal.");
      return;
    }
    const deal = deals.find((d) => d.id === dealId);
    if (deal) onAssigned(deal);
  }

  async function create() {
    if (!name.trim()) {
      setError("Give the deal a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/meetings/${meetingId}/create-deal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok || !body.deal) {
      setError(body.error || "Couldn't create the deal.");
      return;
    }
    onAssigned(body.deal);
  }

  const input = "rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand";
  return (
    <div className="mt-1 px-1 text-xs">
      {mode === "idle" && (
        <span className="text-slate-500">
          Not on a deal ·{" "}
          {deals.length > 0 && (
            <>
              <button type="button" onClick={() => setMode("pick")} className="font-medium text-brand hover:underline">
                Add to a deal
              </button>
              {" or "}
            </>
          )}
          <button type="button" onClick={() => setMode("create")} className="font-medium text-brand hover:underline">
            create a new deal
          </button>
        </span>
      )}
      {mode === "pick" && (
        <span className="flex flex-wrap items-center gap-2">
          <select autoFocus disabled={busy} defaultValue="" onChange={(e) => e.target.value && assign(e.target.value)} className={input}>
            <option value="" disabled>
              Choose a deal…
            </option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setMode("create")} className="font-medium text-brand hover:underline">
            New deal instead
          </button>
          <button type="button" onClick={() => setMode("idle")} className="text-slate-400 hover:text-slate-600">
            Cancel
          </button>
        </span>
      )}
      {mode === "create" && (
        <span className="flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            disabled={busy}
            placeholder="Deal name"
            className={`${input} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="rounded-md bg-brand px-2.5 py-1 font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create deal"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="text-slate-400 hover:text-slate-600">
            Cancel
          </button>
        </span>
      )}
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}
