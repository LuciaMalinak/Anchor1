"use client";

import { useEffect, useRef, useState } from "react";
import { requestFocusWindowPending } from "@/lib/focusWindowBus";
import { registerLocalRecorder } from "@/lib/stopMeeting";
import { registerRecordingStarter } from "@/lib/startRecording";
import { startStreamingTranscription } from "@/lib/liveStreamingTranscription";

// Records straight from the browser's microphone — for an in-person
// meeting or phone call where there's no Zoom/Meet/Teams link for the
// Recall.ai bot to join. The meeting row is created the moment recording
// actually starts (status "recording"), not only once you stop and
// upload — see /api/meetings/mic/start — which is what lets an
// in-person meeting show up in the During tab's live panel, pop the
// Focus window open, and get a real-time transcript + AI coaching, the
// same way a Zoom/Teams call Anchor's bot joins already does. Live
// transcription streams the mic to AssemblyAI (see
// src/lib/liveStreamingTranscription.ts), falling back to the browser's
// own speech recognition (Chrome/Edge and newer Firefox — see
// src/types/speech-recognition.d.ts) when that's unavailable; either way
// it feeds /api/meetings/[id]/live-transcript, and a browser with neither
// just skips that part — the recording still works exactly as before. Once
// you stop, the actual audio gets attached via
// /api/meetings/[id]/finish-recording, which hands it to the same
// transcribe/summarize pipeline a manual upload goes through.
//
// The recording state lives in this hook, called once by whichever
// component owns it for the lifetime of the page (e.g. the top-level
// deal tabs component) — NOT by a panel that unmounts when the user
// switches tabs. That way starting a recording, then clicking around
// to a different tab, doesn't tear down the MediaRecorder/mic stream
// and silently kill the recording. For the same reason, this never
// navigates anywhere on its own once started (unlike the Zoom join
// flow) — the actual capture lives in this browser tab's memory, so
// leaving the page would kill it.

// Sends a line of live transcript to the server: a finished line to
// store, or (partial) an in-progress one the speaker paused on, which is
// only checked for a question to answer right away.
function postLiveText(meetingId: string, text: string, partial: boolean) {
  fetch(`/api/meetings/${meetingId}/live-transcript`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(partial ? { text, partial: true } : { text }),
  }).catch(() => {
    // Best-effort — a dropped live-transcript line doesn't affect the
    // actual recording, which is the source of truth once it uploads and
    // gets properly transcribed.
  });
}

// How long the in-progress (interim) speech has to stop changing before
// it's checked for a question — see startLiveTranscription.
const INTERIM_PAUSE_MS = 600;

export function useMicRecorder({
  dealId,
  onUploaded,
  onStarted,
}: {
  dealId?: string;
  onUploaded?: () => void;
  // Called once the live meeting row exists (right as recording starts)
  // — lets the caller refresh whatever list of meetings it's showing so
  // the new live one shows up (e.g. the deal page's During tab).
  onStarted?: (meetingId: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True once a recorded blob has failed to upload at least once and is
  // still sitting in chunksRef waiting to be retried — distinct from
  // `error`, which also covers failures (mic permission denied, couldn't
  // start) that have nothing left in memory to retry. Drives whether the
  // view offers "Retry upload" or a plain "Start recording".
  const [uploadFailed, setUploadFailed] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recognitionActiveRef = useRef(false);
  // Stops the AssemblyAI live transcript, when that's what's running.
  const streamingStopRef = useRef<(() => void) | null>(null);
  // The meeting this recording belongs to, kept outside start()'s own
  // closure so retryUpload() below can re-attempt the SAME upload later
  // — chunksRef itself is never cleared after a failed upload (only
  // start() resets it, for the NEXT recording), so the audio is still
  // there to resend; this is just what's missing to resend it.
  const meetingIdRef = useRef<string | null>(null);
  // Lets Stop in the live panel, the Focus window, or Ask Anchor stop
  // THIS recorder (so the real audio gets uploaded) — see stopMeeting.ts.
  const unregisterRef = useRef<(() => void) | null>(null);
  // What the browser actually recorded in — Chrome/Firefox give webm,
  // Safari only does mp4 — so the upload is labelled with the real format
  // instead of always claiming webm.
  const mimeTypeRef = useRef("audio/webm");

  // Closing the tab or navigating away mid-recording (or with a failed
  // upload still waiting to retry) used to lose the whole recording with
  // no warning at all — nothing gets uploaded until recorder.onstop
  // fires, which only happens from an explicit Stop click. This can't
  // make the browser actually save anything on its own (there's no
  // reliable way to run an async upload from a beforeunload handler),
  // but it does trigger the browser's own native "leave site? changes
  // may not be saved" confirmation, which is the standard way to at
  // least stop someone from losing a recording by accident.
  useEffect(() => {
    if (!recording && !uploading && !uploadFailed) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [recording, uploading, uploadFailed]);

  // Live transcript for the During tab / Focus window: AssemblyAI's
  // streaming speech-to-text when the server has a key (much more
  // accurate, punctuated, works in every browser — see
  // liveStreamingTranscription.ts), otherwise the browser's own speech
  // recognition. Falls back to the browser's if AssemblyAI drops mid-call.
  async function startLiveTranscription(meetingId: string, stream: MediaStream) {
    const stopStreaming = await startStreamingTranscription(meetingId, stream, {
      onFinal: (text) => postLiveText(meetingId, text, false),
      onPartial: (text) => postLiveText(meetingId, text, true),
      onFailed: () => {
        streamingStopRef.current = null;
        if (streamRef.current) startBrowserRecognition(meetingId);
      },
    });
    // Recording may have been stopped while this was connecting.
    if (!streamRef.current) {
      stopStreaming?.();
      return;
    }
    if (stopStreaming) {
      streamingStopRef.current = stopStreaming;
    } else {
      startBrowserRecognition(meetingId);
    }
  }

  function startBrowserRecognition(meetingId: string) {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return; // No live transcript on this browser — the recording itself is unaffected.
    const recognizer = new Ctor();
    recognizer.continuous = true;
    // Interim results let a question get answered as soon as the speaker
    // pauses, instead of waiting for the browser to decide the line is
    // final (which can lag a second or more, or not happen at all during
    // a long run of speech). Only finals are stored as transcript lines.
    recognizer.interimResults = true;
    // The person's own English variant (en-GB, en-AU, en-IN…) recognizes
    // their accent noticeably better than always forcing en-US.
    const browserLang = navigator.language || "";
    recognizer.lang = /^en(-|$)/i.test(browserLang) ? browserLang : "en-US";
    const post = (text: string, partial: boolean) => postLiveText(meetingId, text, partial);
    let interimTimer: ReturnType<typeof setTimeout> | null = null;
    let lastInterimSent = "";
    recognizer.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript?.trim();
        if (!text) continue;
        if (result.isFinal) {
          post(text, false);
        } else {
          interim += `${text} `;
        }
      }
      if (interimTimer) clearTimeout(interimTimer);
      interim = interim.trim();
      // Once the in-progress line stops changing for a moment (the
      // speaker paused), send it as a partial — the server only checks it
      // for a question to answer; it isn't stored.
      if (interim && interim.split(/\s+/).length >= 3) {
        interimTimer = setTimeout(() => {
          if (interim === lastInterimSent) return;
          lastInterimSent = interim;
          post(interim, true);
        }, INTERIM_PAUSE_MS);
      }
    };
    recognizer.onerror = () => {
      // Swallowed — onend fires right after, and the restart below
      // covers transient errors (a network blip, a brief no-speech
      // timeout) the same way.
    };
    recognizer.onend = () => {
      if (recognitionActiveRef.current) {
        try {
          recognizer.start();
        } catch {
          // Already running — a restart raced with an internal one.
        }
      }
    };
    try {
      recognizer.start();
      recognitionRef.current = recognizer;
      recognitionActiveRef.current = true;
    } catch {
      recognitionActiveRef.current = false;
    }
  }

  // Resolves to why it couldn't start (also shown via `error`), or null
  // once recording — so Ask Anchor can say what went wrong when it's the
  // one that started it (see startRecording.ts).
  async function start(): Promise<string | null> {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      return fail("This browser doesn't support microphone recording.");
    }

    // Opens the Focus window right now, in this same click — see
    // requestFocusWindowPending()'s comment for why it can't wait for
    // the mic permission prompt or the start request below.
    const focusWindow = requestFocusWindowPending();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      focusWindow.cancel();
      return fail("Couldn't access your microphone — check this site's permission in your browser.");
    }

    let meetingId: string;
    try {
      const res = await fetch("/api/meetings/mic/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          title: `In-person recording — ${new Date().toLocaleDateString()}`,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't start this recording");
      meetingId = body.meeting.id;
      meetingIdRef.current = meetingId;
      setUploadFailed(false);
    } catch (err) {
      focusWindow.cancel();
      stream.getTracks().forEach((t) => t.stop());
      return fail(err instanceof Error ? err.message : "Couldn't start this recording");
    }

    streamRef.current = stream;
    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mimeTypeRef.current = recorder.mimeType || mimeType || "audio/webm";
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      // Fires for an explicit Stop AND when the browser ends the recording
      // on its own (mic unplugged, permission revoked) — either way, wind
      // everything down and upload what was captured, rather than leaving
      // the UI showing "Recording" over a recorder that's already dead.
      recorder.onstop = () => {
        finishCapture();
        void upload(meetingId);
      };
      recorder.onerror = () => stop();
      // A timeslice hands audio over every second instead of only once at
      // the very end, so whatever was captured is already in chunksRef if
      // the recorder dies abruptly.
      recorder.start(1000);
    } catch {
      focusWindow.cancel();
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void endWithoutAudio(meetingId);
      return fail("Couldn't start recording on this browser — try Chrome or Edge.");
    }
    // The mic going away (unplugged headset, OS permission pulled) ends
    // the track without the recorder always noticing — stop explicitly so
    // what was captured so far still gets uploaded.
    stream.getAudioTracks().forEach((t) => t.addEventListener("ended", () => stop()));
    mediaRecorderRef.current = recorder;
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);

    unregisterRef.current = registerLocalRecorder(meetingId, stop);
    void startLiveTranscription(meetingId, stream);
    focusWindow.attach(meetingId);
    onStarted?.(meetingId);
    return null;
  }

  function fail(message: string): string {
    setError(message);
    return message;
  }

  // Safe to call any number of times (the banner and the live panel each
  // have a Stop, and Stop can race the mic dropping out) — calling stop()
  // on an already-inactive MediaRecorder throws, which used to leave the
  // recording half torn down.
  function stop() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      // onstop (set in start()) runs finishCapture() and the upload.
      recorder.stop();
    } else {
      finishCapture();
    }
  }

  // Releases the mic, timer and live transcription — everything except
  // the recorded audio itself, which upload() still needs.
  function finishCapture() {
    unregisterRef.current?.();
    unregisterRef.current = null;
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamingStopRef.current?.();
    streamingStopRef.current = null;
    recognitionActiveRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
  }

  // No usable audio for this meeting — have the server wrap it up from
  // its live transcript (see /api/meetings/[id]/stop) instead of leaving
  // it showing as live forever.
  async function endWithoutAudio(meetingId: string) {
    await fetch(`/api/meetings/${meetingId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {});
  }

  async function upload(meetingId: string) {
    const mimeType = mimeTypeRef.current;
    const blob = new Blob(chunksRef.current, { type: mimeType });
    if (blob.size === 0) {
      setError("No audio was captured — check your microphone and try again.");
      void endWithoutAudio(meetingId);
      onUploaded?.();
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await sendRecording(meetingId, blob, `recording-${Date.now()}.${extensionFor(mimeType)}`);
      setUploadFailed(false);
      onUploaded?.();
    } catch (err) {
      // The recorded audio in chunksRef is untouched by a failed upload —
      // nothing here clears it — so this is genuinely retryable, unlike
      // before, when a failed upload had no path back except re-recording
      // the whole meeting from scratch.
      setUploadFailed(true);
      setError(
        (err instanceof Error ? err.message : "Upload failed") +
          " — your recording is still here, so it's safe to try again."
      );
    } finally {
      setUploading(false);
    }
  }

  // Re-sends the SAME recorded audio still sitting in chunksRef — see
  // upload()'s comment on why that's safe.
  async function retryUpload() {
    if (!meetingIdRef.current) return;
    await upload(meetingIdRef.current);
  }

  // Explicit escape hatch for someone who doesn't want to keep retrying a
  // failed upload and would rather just start over — otherwise the failed
  // recording (and its beforeunload warning) would linger forever with no
  // way to clear it short of reloading the page.
  function discardFailedUpload() {
    if (meetingIdRef.current) void endWithoutAudio(meetingIdRef.current);
    chunksRef.current = [];
    meetingIdRef.current = null;
    setUploadFailed(false);
    setError(null);
  }

  // Lets Ask Anchor start a recording on this deal (see startRecording.ts).
  // The latest start/recording are read through a ref so the registration
  // itself only changes when the deal does.
  const latestRef = useRef({ start, recording });
  useEffect(() => {
    latestRef.current = { start, recording };
  });
  useEffect(() => {
    if (!dealId) return;
    return registerRecordingStarter(dealId, async () => {
      if (latestRef.current.recording) return "A recording is already running on this deal.";
      return latestRef.current.start();
    });
  }, [dealId]);

  return { recording, seconds, uploading, error, uploadFailed, start, stop, retryUpload, discardFailedUpload };
}

export type MicRecorderState = ReturnType<typeof useMicRecorder>;

// Pure presentational view — driven entirely by the state/handlers a
// useMicRecorder() call up the tree hands down as props, so it can be
// rendered from more than one tab without losing the recording.
export function MicRecorderView({
  recording,
  seconds,
  uploading,
  error,
  uploadFailed,
  start,
  stop,
  retryUpload,
  discardFailedUpload,
}: MicRecorderState) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    // h-full + justify-between: this card sits next to "Upload a
    // recording" (see NewMeetingForms in DealTabs.tsx), which usually
    // has more content and is taller. h-full lets this card match that
    // stretched height instead of staying its own shorter, content-sized
    // height (leaving a mismatched card with dead space below it) —
    // harmless where this renders without a stretched parent (e.g. the
    // During tab's "already in a call" list), since h-full is then just
    // 100% of an auto-height parent, i.e. no-op. justify-between pins
    // the button to the bottom of whatever height that ends up being,
    // rather than leaving a gap between it and the description above.
    <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200 border-l-4 border-l-accent bg-white p-6 shadow-sm">
      <div>
        <p className="text-sm font-medium text-slate-900">Record in person</p>
        <p className="mt-1 text-xs text-slate-500">
          For a call or meeting Anchor can&apos;t join on its own — record straight from
          this device&apos;s microphone. Recording keeps running even if you switch tabs.
        </p>
      </div>
      <div className="mt-3">
        <div className="flex items-center gap-3">
          {recording ? (
            <>
              <button
                type="button"
                onClick={stop}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                Stop
              </button>
              <span className="text-sm font-mono text-slate-600">
                {mm}:{ss}
              </span>
            </>
          ) : uploadFailed ? (
            <>
              <button
                type="button"
                onClick={retryUpload}
                disabled={uploading}
                className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
              >
                {uploading ? "Retrying…" : "Retry upload"}
              </button>
              <button
                type="button"
                onClick={discardFailedUpload}
                disabled={uploading}
                className="text-xs font-medium text-slate-400 hover:text-slate-600 hover:underline disabled:opacity-50"
              >
                Discard and start over
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={uploading}
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              {uploading ? "Uploading…" : "Start recording"}
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

// Small persistent banner — meant to render above/outside the tab
// content so it stays visible no matter which tab (Before/During/
// After/Chat) is active while a recording is running.
export function RecordingBanner({ recording, seconds, stop }: MicRecorderState) {
  if (!recording) return null;
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <div className="flex items-center justify-between rounded-lg border border-red-300 bg-red-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
        <p className="text-sm font-medium text-red-900">
          Recording in person — {mm}:{ss}
        </p>
        <span className="text-xs text-red-700">Keeps going while you use other tabs.</span>
      </div>
      <button
        type="button"
        onClick={stop}
        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
      >
        Stop
      </button>
    </div>
  );
}

function pickMimeType(): string | undefined {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

// Uploads a finished recording, retrying a couple of times on network
// drops and server errors before giving up — a long meeting's upload is
// big, and one flaky moment on hotel/office Wi-Fi shouldn't need a manual
// retry. A 4xx means retrying won't help, so that fails straight away.
async function sendRecording(meetingId: string, blob: Blob, fileName: string): Promise<void> {
  const delays = [2000, 5000];
  for (let attempt = 0; ; attempt++) {
    let message: string;
    try {
      const formData = new FormData();
      formData.append("file", blob, fileName);
      const res = await fetch(`/api/meetings/${meetingId}/finish-recording`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) return;
      const body = await res.json().catch(() => ({}));
      message = body.error || "Upload failed";
      if (res.status < 500) throw new Error(message);
    } catch (err) {
      // fetch() itself rejects with a TypeError on a network drop —
      // retryable. Anything else is the 4xx thrown just above.
      if (!(err instanceof TypeError)) throw err;
      message = "Upload failed — check your connection";
    }
    if (attempt >= delays.length) throw new Error(message);
    await new Promise((r) => setTimeout(r, delays[attempt]));
  }
}
