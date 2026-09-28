"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type DealOption = { id: string; name: string };

// Lets whoever recorded this meeting fix its deal assignment after the
// fact — the desktop app's auto-match (see
// src/app/api/desktop/deals/match-now/route.ts) and a bot-joined call's
// contact matching are both best-effort, so this is the safety net when
// either guessed wrong or found nothing at all. Only rendered for the
// meeting's owner (see the page) — reassigning someone else's meeting
// isn't something a teammate should be able to do from here.
export function MeetingDealPicker({
  meetingId,
  currentDealId,
  currentDealName,
  deals,
}: {
  meetingId: string;
  currentDealId: string | null;
  currentDealName: string | null;
  deals: DealOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(nextDealId: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: nextDealId || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't update this meeting's deal");
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update this meeting's deal");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        {currentDealId ? (
          <Link href={`/dashboard/deals/${currentDealId}`} className="font-medium text-brand hover:underline">
            {currentDealName || "View deal"}
          </Link>
        ) : (
          <span className="text-slate-400">Not attached to a deal</span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-slate-400 hover:text-slate-600 hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        autoFocus
        disabled={saving}
        defaultValue={currentDealId ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setEditing(false)}
        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10"
      >
        <option value="">Not attached to a deal</option>
        {deals.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {saving && <span className="text-xs text-slate-400">Saving…</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
