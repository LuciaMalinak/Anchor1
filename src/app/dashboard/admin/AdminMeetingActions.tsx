"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Stop / Delete buttons on the admin Overview's failed and stuck lists.
// Both ask first; see src/lib/adminMeetingActions.ts for what they do.
export function AdminMeetingActions({
  meetingId,
  title,
  canStop,
  canRetry = false,
}: {
  meetingId: string;
  title: string;
  canStop: boolean;
  canRetry?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"stop" | "retry" | "delete" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(kind: "stop" | "retry" | "delete") {
    const question =
      kind === "stop"
        ? `Stop "${title}"? If it's still recording, recording ends now.`
        : kind === "delete"
          ? `Permanently delete "${title}", with its transcript, summary and audio? This can't be undone.`
          : null;
    if (question && !window.confirm(question)) return;
    setBusy(kind);
    setNote(null);
    try {
      const res = await fetch(
        kind === "delete"
          ? `/api/admin/meetings/${meetingId}`
          : `/api/admin/meetings/${meetingId}/${kind}`,
        {
          method: kind === "delete" ? "DELETE" : "POST",
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body.error || "That didn't work — try again.");
      setNote(kind === "delete" ? "Deleted." : body.note || "Done.");
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
      {canRetry && (
        <button
          type="button"
          onClick={() => void run("retry")}
          disabled={busy !== null}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "retry" ? "Retrying…" : "Retry"}
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

// Writes real summaries for every meeting that was saved transcript-only
// while Anthropic credits ran out — meant for right after topping up.
export function FillMissingSummariesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    if (
      !window.confirm(
        "Write AI summaries for every meeting that's missing one? This uses Anthropic credits — add them first.",
      )
    )
      return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/meetings/fill-summaries", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "That didn't work — try again.");
      setNote(
        body.count === 0
          ? "Every meeting already has a summary."
          : `Writing ${body.count} summar${body.count === 1 ? "y" : "ies"} — refresh in a few minutes.`,
      );
      router.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't work — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? "Starting…" : "Fill in missing summaries"}
      </button>
      {note && <span className="text-xs text-slate-500">{note}</span>}
    </div>
  );
}
