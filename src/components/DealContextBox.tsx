"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "type" | "record" | "upload";

// The Before tab's "Give Anchor more context" box — a catch-all for
// background the rep knows going in that isn't a file and isn't
// something that happened in a meeting yet: a heads-up about the
// stakeholder, a constraint on pricing, a reminder of what was promised
// last time. Three ways in, all of which end up feeding Anchor's
// meeting prep (see dealFilesContext.ts and its callers — live
// coaching, handoff briefings, and the rolling deal-memory merge, plus
// Ask Anchor which already read deals.notes and dealFiles directly):
//   - Type: appends a dated entry via /api/deals/[id]/context/note.
//   - Record: transcribes via /api/deals/[id]/context/voice-note and
//     appends the transcript the same way (audio itself is discarded —
//     this is meant to feel like talking instead of typing, not another
//     recording archive).
//   - Upload: reuses the existing /api/deals/[id]/files pipeline
//     (already extracted and read by Ask Anchor, and now also folded
//     into the same bounded digest the other AI touchpoints read).
//
// Type and Record are both deliberately append-only, not edit-in-place —
// each save clears the box rather than reloading what's already stored.
// There's nothing to directly edit or delete here: the only way to
// change what Anchor knows is to add something new — another note here,
// something said in a call (which updates the deal's rolling memory —
// see summarize.ts), or a corrected file upload.
export function DealContextBox({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("type");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-[11px] font-semibold tracking-[0.15em] text-accent">GIVE ANCHOR MORE CONTEXT</p>
      <p className="mt-1 text-xs text-slate-500">
        Anything Anchor should know going into the next meeting — type it, talk it out, or attach
        a file. This feeds meeting prep, live coaching, and Ask Anchor.
      </p>

      <div className="mt-4 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        {(
          [
            { key: "type", label: "Type" },
            { key: "record", label: "Record" },
            { key: "upload", label: "Upload a file" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMode(tab.key)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
              mode === tab.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {mode === "type" && <TypeMode dealId={dealId} onSaved={() => router.refresh()} />}
        {mode === "record" && (
          <RecordMode dealId={dealId} onTranscribed={() => router.refresh()} />
        )}
        {mode === "upload" && (
          <UploadMode dealId={dealId} onUploaded={() => router.refresh()} />
        )}
      </div>
    </div>
  );
}

function TypeMode({ dealId, onSaved }: { dealId: string; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    setLastAdded(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/context/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save that.");
      }
      // Clear rather than keep the saved text on screen — this is a log
      // entry, not a document being edited, so the box resets and is
      // ready for the next thing worth telling Anchor.
      setText("");
      setLastAdded(trimmed);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="e.g. They're price-sensitive right now — budget was just cut. Don't lead with the premium tier."
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !text.trim()}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      {lastAdded && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Added: &ldquo;{lastAdded.length > 160 ? `${lastAdded.slice(0, 160)}…` : lastAdded}&rdquo; — Anchor will
          keep this in mind going forward. To correct it, add a new note rather than edit this one.
        </p>
      )}
    </div>
  );
}

function RecordMode({ dealId, onTranscribed }: { dealId: string; onTranscribed: () => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function start() {
    setError(null);
    setLastTranscript(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser doesn't support microphone recording.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        void transcribeAndSave();
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

  async function transcribeAndSave() {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    if (blob.size === 0) {
      setError("Nothing was recorded — try again.");
      return;
    }
    setTranscribing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", blob, `context-${Date.now()}.webm`);
      const res = await fetch(`/api/deals/${dealId}/context/voice-note`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't transcribe that recording.");
      }
      const body = await res.json();
      setLastTranscript(body.transcript || null);
      onTranscribed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't transcribe that recording.");
    } finally {
      setTranscribing(false);
    }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div>
      <p className="text-xs text-slate-500">
        Talk it out — Anchor transcribes it and adds it to this deal&apos;s notes. The recording
        itself isn&apos;t kept, just the words.
      </p>
      <div className="mt-3 flex items-center gap-3">
        {!recording ? (
          <button
            type="button"
            onClick={start}
            disabled={transcribing}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            {transcribing ? "Transcribing…" : "Start recording"}
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
      {lastTranscript && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Added: &ldquo;{lastTranscript.length > 160 ? `${lastTranscript.slice(0, 160)}…` : lastTranscript}&rdquo;
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function UploadMode({ dealId, onUploaded }: { dealId: string; onUploaded: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setUploadedName(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file first.");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/files`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
      setUploadedName(file.name);
      form.reset();
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleUpload}>
      <p className="text-xs text-slate-500">
        A contract, prior proposal, spec, or notes doc — it&apos;ll show up in the Files list below too.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <input
          type="file"
          name="file"
          className="flex-1 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:border-slate-400"
        />
        <button
          type="submit"
          disabled={uploading}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
      {uploadedName && <p className="mt-2 text-xs text-emerald-600">Added {uploadedName}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}
