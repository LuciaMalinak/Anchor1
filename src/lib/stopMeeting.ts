"use client";

// One way to stop a live meeting from anywhere in the app — the Stop
// button in the live panel and Focus window, and Ask Anchor when someone
// tells it to stop. An in-person recording's audio only exists in the
// browser tab that started it (useMicRecorder), so when that tab is the
// one asking, stop its recorder directly: that uploads the real audio.
// Otherwise ask the server, which leaves the call for a bot, or wraps an
// in-person recording up from its live transcript (see
// src/app/api/meetings/[id]/stop/route.ts).
//
// "That tab" isn't always this window: the Focus window's popup fallback
// (Safari and other browsers without Picture-in-Picture), or a second tab
// on the same deal, is a separate page whose localRecorders map is empty.
// Those used to fall straight through to the server, which ended the
// meeting with no audio while the real tab kept recording — and then
// rejected that audio as "already finished" once it was finally stopped.
// A BroadcastChannel lets them ask the recording tab to stop itself first.
const localRecorders = new Map<string, () => void>();

const CHANNEL_NAME = "anchor-local-recorders";
const REMOTE_STOP_TIMEOUT_MS = 1500;

type RecorderMessage =
  | { type: "stop"; meetingId: string; requestId: string }
  | { type: "stopped"; requestId: string };

let listener: BroadcastChannel | null = null;

// Answers stop requests from other windows for the recorders this window
// holds. Set up lazily, the first time this window starts a recording.
function listenForRemoteStops() {
  if (listener || typeof BroadcastChannel === "undefined") return;
  listener = new BroadcastChannel(CHANNEL_NAME);
  listener.onmessage = (e: MessageEvent<RecorderMessage>) => {
    const msg = e.data;
    if (msg?.type !== "stop") return;
    const local = localRecorders.get(msg.meetingId);
    if (!local) return;
    local();
    listener?.postMessage({ type: "stopped", requestId: msg.requestId } satisfies RecorderMessage);
  };
}

// Resolves true once another window confirms it stopped this meeting's
// recorder, false if nobody answers (no open tab is recording it).
function stopInAnotherWindow(meetingId: string): Promise<boolean> {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(false);
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const done = (stopped: boolean) => {
      clearTimeout(timer);
      channel.close();
      resolve(stopped);
    };
    const timer = setTimeout(() => done(false), REMOTE_STOP_TIMEOUT_MS);
    channel.onmessage = (e: MessageEvent<RecorderMessage>) => {
      if (e.data?.type === "stopped" && e.data.requestId === requestId) done(true);
    };
    channel.postMessage({ type: "stop", meetingId, requestId } satisfies RecorderMessage);
  });
}

// Called by useMicRecorder once a recording is running; returns the
// matching unregister for when it stops.
export function registerLocalRecorder(meetingId: string, stop: () => void): () => void {
  listenForRemoteStops();
  localRecorders.set(meetingId, stop);
  return () => {
    if (localRecorders.get(meetingId) === stop) localRecorders.delete(meetingId);
  };
}

export type StopMeetingResult =
  | { ok: true }
  | { ok: false; error: string; canForceEnd: boolean };

// `inPerson: false` skips asking other windows — a bot-joined call has no
// local recorder anywhere, so there's no point waiting on an answer.
export async function stopMeeting(
  meetingId: string,
  force = false,
  { inPerson = true }: { inPerson?: boolean } = {}
): Promise<StopMeetingResult> {
  const local = localRecorders.get(meetingId);
  if (local) {
    local();
    return { ok: true };
  }
  if (inPerson && (await stopInAnotherWindow(meetingId))) {
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
