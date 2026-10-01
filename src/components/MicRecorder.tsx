"use client";

import { useEffect, useRef, useState } from "react";
import { requestFocusWindowPending } from "@/lib/focusWindowBus";

// Records straight from the browser's microphone — for an in-person
// meeting or phone call where there's no Zoom/Meet/Teams link for the
// Recall.ai bot to join. The meeting row is created the moment recording
// actually starts (status "recording"), not only once you stop and
// upload — see /api/meetings/mic/start — which is what lets an
// in-person meeting show up in the During tab's live panel, pop the
// Focus window open, and get a real-time transcript + AI coaching, the
// same way a Zoom/Teams call Anchor's bot joins already does. Live
// transcription itself runs on the browser's own speech recognition
// (Chrome/Edge and newer Firefox — see src/types/speech-recognition.d.ts)
// and feeds /api/meetings/[id]/live-transcript; unsupported browsers just
// skip that part and the recording still works exactly as before. Once
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
  // The meeting this recording belongs to, kept outside start()'s own
  // closure so retryUpload() below can re-attempt the SAME upload later
  // — chunksRef itself is never cleared after a failed upload (only
  // start() resets it, for the NEXT recording), so the audio is still
  // there to resend; this is just what's missing to resend it.
  const meetingIdRef = useRef<string | null>(null);

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
    if (!recording && !uploadFailed) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [recording, uploadFailed]);

  function startLiveTranscription(meetingId: string) {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return; // No live transcript on this browser — the recording itself is unaffected.
    const recognizer = new Ctor();
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = "en-US";
    recognizer.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result.isFinal) continue;
        const text = result[0]?.transcript?.trim();
        if (!text) continue;
        fetch(`/api/meetings/${meetingId}/live-transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }).catch(() => {
          // Best-effort — a dropped live-transcript line doesn't affect
          // the actual recording, which is the source of truth once it
          // uploads and gets properly transcribed.
        });
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

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser doesn't support microphone recording.");
      return;
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
      setError("Couldn't access your microphone — check this site's permission in your browser.");
      return;
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
      setError(err instanceof Error ? err.message : "Couldn't start this recording");
      return;
    }

    streamRef.current = stream;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : undefined;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      void upload(meetingId);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);

    startLiveTranscription(meetingId);
    focusWindow.attach(meetingId);
    onStarted?.(meetingId);
  }

  function stop() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    recognitionActiveRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
  }

  async function upload(meetingId: string) {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    if (blob.size === 0) {
      setError("Nothing was recorded — try again.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", blob, `recording-${Date.now()}.webm`);
      const res = await fetch(`/api/meetings/${meetingId}/finish-recording`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
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
    chunksRef.current = [];
    meetingIdRef.current = null;
    setUploadFailed(false);
    setError(null);
  }

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
