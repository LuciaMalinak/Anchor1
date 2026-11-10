"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMicRecorder } from "@/components/MicRecorder";

type Deal = { id: string; name: string };

// Record an in-person meeting from the phone: pick the deal (optional),
// tap the big button, tap again to stop. Uses the same recorder as the
// dashboard and deal pages (MicRecorder.tsx), so the call is transcribed,
// summarised and added to the deal exactly like any other.
export function RecordClient() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealId, setDealId] = useState("");

  useEffect(() => {
    fetch("/api/deals")
      .then((r) => (r.ok ? r.json() : { deals: [] }))
      .then((d: { deals?: Deal[] }) => setDeals(d.deals ?? []))
      .catch(() => {});
  }, []);

  // Remount the recorder when the deal changes (it's chosen before
  // recording starts and locked while recording).
  return <Recorder key={dealId || "none"} deals={deals} dealId={dealId} setDealId={setDealId} />;
}

function Recorder({ deals, dealId, setDealId }: { deals: Deal[]; dealId: string; setDealId: (id: string) => void }) {
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const mic = useMicRecorder({
    dealId: dealId || undefined,
    onStarted: (id) => {
      setMeetingId(id);
      setDone(false);
    },
    onUploaded: () => setDone(true),
  });
  const mm = String(Math.floor(mic.seconds / 60)).padStart(2, "0");
  const ss = String(mic.seconds % 60).padStart(2, "0");
  const percent = `${Math.round(mic.uploadProgress * 100)}%`;
  const busy = mic.recording || mic.uploading;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 pt-2 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Record a meeting</h1>
        <p className="mt-1 text-sm text-slate-500">
          For in-person meetings. Keep the phone on the table, screen on. Anchor writes the summary
          when you stop.
        </p>
      </div>

      <label className="w-full text-left">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Deal</span>
        <select
          value={dealId}
          onChange={(e) => setDealId(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 disabled:opacity-60"
        >
          <option value="">No deal yet (choose later)</option>
          {deals.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={mic.recording ? mic.stop : mic.start}
        disabled={mic.uploading}
        aria-label={mic.recording ? "Stop recording" : "Start recording"}
        className={`flex h-40 w-40 items-center justify-center rounded-full shadow-xl transition active:scale-95 disabled:opacity-60 ${
          mic.recording ? "bg-red-600" : "bg-white ring-8 ring-red-100"
        }`}
      >
        {mic.recording ? (
          <span className="h-12 w-12 rounded-lg bg-white" />
        ) : (
          <span className="h-20 w-20 rounded-full bg-red-600" />
        )}
      </button>

      <div className="min-h-[3.5rem]">
        {mic.recording ? (
          <>
            <p className="font-mono text-3xl text-slate-900">
              {mm}:{ss}
            </p>
            <p className="mt-1 flex items-center justify-center gap-2 text-sm text-red-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" /> Recording. Tap to stop.
            </p>
          </>
        ) : mic.uploading ? (
          <p className="text-base text-slate-700">Saving the recording… {percent}</p>
        ) : mic.uploadFailed ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-red-600">The recording didn&apos;t upload. It&apos;s still on this phone.</p>
            <button type="button" onClick={mic.retryUpload} className="rounded-xl bg-brand px-4 py-2.5 text-base font-medium text-white">
              Try again
            </button>
            <button type="button" onClick={mic.saveCopy} className="text-sm text-brand underline">
              Save a copy to this phone
            </button>
          </div>
        ) : done && meetingId ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-base text-slate-800">Saved. Anchor is writing the summary.</p>
            <Link href={`/dashboard/meetings/${meetingId}`} className="rounded-xl bg-brand px-4 py-2.5 text-base font-medium text-white">
              Open the meeting
            </Link>
          </div>
        ) : (
          <p className="text-base text-slate-500">Tap to start recording</p>
        )}
        {mic.error && <p className="mt-2 text-sm text-red-600">{mic.error}</p>}
      </div>

      <p className="text-xs text-slate-400">
        Let everyone know the meeting is being recorded; some places require their consent.
      </p>
    </div>
  );
}
