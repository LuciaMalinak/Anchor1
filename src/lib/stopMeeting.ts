"use client";

// One way to stop a live meeting from anywhere in the app — the Stop
// button in the live panel and Focus window, and Ask Anchor when someone
// tells it to stop. An in-person recording's audio only exists in the
// browser tab that started it (useMicRecorder), so when that tab is the
// one asking, stop its recorder directly: that uploads the real audio.
// Otherwise ask the server, which leaves the call for a bot, or wraps an
// in-person recording up from its live transcript (see
// src/app/api/meetings/[id]/stop/route.ts).
const localRecorders = new Map<string, () => void>();

// Called by useMicRecorder once a recording is running; returns the
// matching unregister for when it stops.
export function registerLocalRecorder(meetingId: string, stop: () => void): () => void {
  localRecorders.set(meetingId, stop);
  return () => {
    if (localRecorders.get(meetingId) === stop) localRecorders.delete(meetingId);
  };
}

export type StopMeetingResult =
  | { ok: true }
  | { ok: false; error: string; canForceEnd: boolean };

export async function stopMeeting(meetingId: string, force = false): Promise<StopMeetingResult> {
  const local = localRecorders.get(meetingId);
  if (local) {
    local();
    return { ok: true };
  }
  try {
    const res = await fetch(`/api/meetings/${meetingId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: body.error || "Couldn't end the meeting",
        canForceEnd: Boolean(body.canForceEnd),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't end the meeting", canForceEnd: false };
  }
}
