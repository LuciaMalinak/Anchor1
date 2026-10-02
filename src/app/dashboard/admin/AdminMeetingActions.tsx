"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Stop / Delete buttons on the admin Overview's failed and stuck lists.
// Both ask first; see src/lib/adminMeetingActions.ts for what they do.
export function AdminMeetingActions({
  meetingId,
  title,
  canStop,
}: {
  meetingId: string;
  title: string;
  canStop: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"stop" | "delete" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(kind: "stop" | "delete") {
    const question =
      kind === "stop"
        ? `Stop "${title}"? If it's still recording, recording ends now.`
        : `Permanently delete "${title}", with its transcript, summary and audio? This can't be undone.`;
    if (!window.confirm(question)) return;
    setBusy(kind);
    setNote(null);
    try {
      const res = await fetch(
        kind === "stop"
          ? `/api/admin/meetings/${meetingId}/stop`
          : `/api/admin/meetings/${meetingId}`,
        {
          method: kind === "stop" ? "POST" : "DELETE",
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body.error || "That didn't work — try again.");
      setNote(kind === "stop" ? body.note || "Stopped." : "Deleted.");
      router.refresh();
    } catch (err) {
      setNote(
        err instanceof Error ? err.message : "That didn't work — try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {note && <span className="text-xs text-slate-500">{note}</span>}
      {canStop && (
        <button
          type="button"
          onClick={() => void run("stop")}
          disabled={busy !== null}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "stop" ? "Stopping…" : "Stop"}
        </button>
      )}
      <button
        type="button"
        onClick={() => void run("delete")}
        disabled={busy !== null}
        className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
      >
        {busy === "delete" ? "Deleting…" : "Delete"}
      </button>
    </div>
  );
}
