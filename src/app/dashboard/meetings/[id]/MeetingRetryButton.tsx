"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "Try again" for a meeting that failed to process: fetches the recording
// if it never arrived, then writes the meeting up again.
export function MeetingRetryButton({ meetingId, compact }: { meetingId: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/meetings/${meetingId}/retry`, { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) setError(body.error || "Couldn't start it again.");
    else router.refresh();
  }

  return (
    <span className={compact ? "inline-flex items-center gap-2" : "flex flex-col items-center gap-1"}>
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className={
          compact
            ? "text-xs font-medium text-brand hover:underline disabled:opacity-50"
            : "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        }
      >
        {busy ? "Starting…" : "Try again"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
