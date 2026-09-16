"use client";

import { useRef, useState } from "react";

// Records straight from the browser's microphone — for an in-person
// meeting or phone call where there's no Zoom/Meet/Teams link for the
// Recall.ai bot to join. Stops, uploads the recording through the same
// /api/meetings endpoint a file upload uses, and lets the caller decide
// how to refresh afterward (router.refresh() in the deal tabs, a manual
// re-fetch on the standalone dashboard).
export function MicRecorder({
  dealId,
  onUploaded,
}: {
  dealId?: string;
  onUploaded?: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser doesn't support microphone recording.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        void upload();
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("Couldn't access your microphone — check this site's permission in your browser.");
    }
  }

  function stop() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }

  async function upload() {
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
      formData.append(
        "title",
        `In-person recording — ${new Date().toLocaleDateString()}`
      );
      if (dealId) formData.append("dealId", dealId);
      const res = await fetch("/api/meetings", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
      onUploaded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-sm font-medium text-slate-900">Record in person</p>
      <p className="mt-1 text-xs text-slate-500">
        For a call or meeting Anchor can&apos;t join on its own — record straight from
        this device&apos;s microphone.
      </p>
      <div className="mt-3 flex items-center gap-3">
        {!recording ? (
          <button
            type="button"
            onClick={start}
            disabled={uploading}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            {uploading ? "Uploading…" : "Start recording"}
          </button>
        ) : (
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
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
