"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MicRecorder } from "@/components/MicRecorder";

type Meeting = {
  id: string;
  title: string;
  status:
    | "joining"
    | "recording"
    | "uploaded"
    | "transcribing"
    | "summarizing"
    | "ready"
    | "failed";
  errorMessage: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<Meeting["status"], string> = {
  joining: "Joining meeting…",
  recording: "Recording…",
  uploaded: "Queued",
  transcribing: "Transcribing…",
  summarizing: "Summarizing…",
  ready: "Ready",
  failed: "Failed",
};

export function DashboardClient({ initialMeetings }: { initialMeetings: Meeting[] }) {
  const [meetings, setMeetings] = useState<Meeting[]>(initialMeetings);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const joinFormRef = useRef<HTMLFormElement>(null);

  const hasInFlight = meetings.some(
    (m) => m.status !== "ready" && m.status !== "failed"
  );

  const refresh = useCallback(async () => {
    const res = await fetch("/api/meetings");
    if (res.ok) {
      const data = await res.json();
      setMeetings(data.meetings);
    }
  }, []);

  useEffect(() => {
    if (!hasInFlight) return;
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [hasInFlight, refresh]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a recording to upload first.");
      return;
    }

    setUploading(true);
    try {
      const res = await fetch("/api/meetings", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
      form.reset();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleJoinSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setJoinError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const meetingUrl = String(formData.get("meetingUrl") || "").trim();
    const title = String(formData.get("title") || "").trim();
    if (!meetingUrl) {
      setJoinError("Paste a meeting link first.");
      return;
    }

    setJoining(true);
    try {
      const res = await fetch("/api/meetings/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl, title }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't send Anchor to that meeting");
      }
      form.reset();
      await refresh();
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Couldn't send Anchor to that meeting");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-medium text-slate-900">Send Anchor to a live meeting</h2>
          <p className="mt-1 text-sm text-slate-500">
            Paste a Zoom, Google Meet, or Teams link and Anchor will join automatically,
            record it, and process it the same way as an upload — no need to record it
            yourself.
          </p>
          <form
            ref={joinFormRef}
            onSubmit={handleJoinSubmit}
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <input
              type="text"
              name="title"
              placeholder="Title (optional)"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            <input
              type="text"
              name="meetingUrl"
              placeholder="https://zoom.us/j/..."
              className="flex-[2] rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            <button
              type="submit"
              disabled={joining}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {joining ? "Sending…" : "Join meeting"}
            </button>
          </form>
          {joinError && <p className="mt-2 text-sm text-red-600">{joinError}</p>}
        </section>

        <MicRecorder onUploaded={refresh} />
      </div>

      <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-900">Upload a meeting recording</h2>
        <p className="mt-1 text-sm text-slate-500">
          Audio or video, up to 500MB. Anchor will transcribe it, summarize it, and
          remember the people in it for next time.
        </p>
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <input
            type="text"
            name="title"
            placeholder="Title (optional — we'll suggest one)"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <input
            type="file"
            name="file"
            accept="audio/*,video/*"
            required
            className="flex-1 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <button
            type="submit"
            disabled={uploading}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-slate-900">Your meetings</h2>
        {meetings.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing uploaded yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {meetings.map((m) => (
              <div key={m.id}>
                <Link
                  href={`/dashboard/meetings/${m.id}`}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                >
                  <span className="truncate text-sm font-medium text-slate-900">{m.title}</span>
                  <span
                    className={`ml-2 shrink-0 text-xs font-medium ${
                      m.status === "ready"
                        ? "text-green-600"
                        : m.status === "failed"
                        ? "text-red-600"
                        : "text-amber-600"
                    }`}
                  >
                    {STATUS_LABEL[m.status]}
                  </span>
                </Link>
                {m.status === "failed" && m.errorMessage && (
                  <p className="mt-1 px-1 text-xs text-red-600">{m.errorMessage}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
