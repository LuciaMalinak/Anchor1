"use client";

import { useState } from "react";

// Lets someone end a live "Send Anchor to a live meeting" bot early,
// instead of waiting for the call to end on its own — see
// src/app/api/meetings/[id]/stop/route.ts. Important: this does NOT hang
// up the call for anyone else — it only makes Anchor's bot leave.
// Anything already recorded up to that point still gets processed
// normally through the same pipeline a call ending naturally goes
// through.
export function StopMeetingButton({
  meetingId,
  variant = "light",
}: {
  meetingId: string;
  // "light": sits on the dark brand header (LiveMeetingPanel).
  // "solid": sits on a plain white background (FocusWindow).
  variant?: "light" | "solid";
}) {
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server says this specific failure can be forced through
  // instead of retried — see the route's `force` handling. Lets Stop
  // offer a guaranteed way out instead of just repeating the same error.
  const [canForceEnd, setCanForceEnd] = useState(false);

  async function stop(force = false) {
    setStopping(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCanForceEnd(Boolean(body.canForceEnd));
        throw new Error(body.error || "Couldn't end the meeting");
      }
      // Deliberately leaving `stopping`/`confirming` as-is on success —
      // the live poll elsewhere (useLiveMeeting) picks up the status
      // change within a couple of seconds and swaps the whole panel to
      // the "meeting ended" state, rather than this button flipping back
      // to a clickable "Stop" for the second or two before that happens.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't end the meeting");
      setStopping(false);
    }
  }

  const mutedText = variant === "light" ? "text-white/80" : "text-slate-500";
  const cancelText =
    variant === "light" ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-slate-600";
  const errorText = variant === "light" ? "text-red-100" : "text-red-600";

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-xs ${mutedText}`}>
          Anchor leaves the call — doesn&apos;t end the meeting for anyone else.
        </span>
        <button
          type="button"
          onClick={() => stop(false)}
          disabled={stopping}
          className="shrink-0 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {stopping ? "Ending…" : "Confirm"}
        </button>
        {!stopping && (
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className={`shrink-0 text-xs font-medium ${cancelText}`}
          >
            Cancel
          </button>
        )}
        {error && <span className={`text-xs ${errorText}`}>{error}</span>}
        {/* Only shown after a failed attempt whose error the server says
            is safe to force through — not offered up front, so a normal
            Stop always tries the clean path first. */}
        {error && canForceEnd && !stopping && (
          <button
            type="button"
            onClick={() => stop(true)}
            className="shrink-0 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
          >
            End it anyway
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="Have Anchor leave the call now — this doesn't end the meeting for anyone else"
        className={
          variant === "light"
            ? "rounded-md bg-white/15 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-500/80"
            : "rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
        }
      >
        Stop
      </button>
      {error && <span className={`text-xs ${errorText}`}>{error}</span>}
    </div>
  );
}
