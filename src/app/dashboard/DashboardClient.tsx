"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMicRecorder, MicRecorderView } from "@/components/MicRecorder";
import { TodayMeetings } from "@/components/TodayMeetings";
import { requestFocusWindowPending } from "@/lib/focusWindowBus";

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

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m-6.5 0 .6 9.4A1.5 1.5 0 0 0 7.6 17h4.8a1.5 1.5 0 0 0 1.5-1.6L14.5 6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DashboardClient({ initialMeetings }: { initialMeetings: Meeting[] }) {
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>(initialMeetings);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  const mic = useMicRecorder({ onUploaded: refresh, onStarted: refresh });

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

    // Opens the actual Zoom/Meet/Teams page so you join it as yourself
    // too, not just as a name Anchor's bot brings into the room — a
    // direct result of this click, so it won't get popup-blocked.
    window.open(meetingUrl, "_blank", "noopener,noreferrer");

    // Also opens the Focus window right now, before the meeting even
    // exists yet — see requestFocusWindowPending()'s comment for why it
    // has to happen here, synchronously in this click, rather than after
    // the fetch below comes back with a meeting id.
    const focusWindow = requestFocusWindowPending();

    setJoining(true);
    try {
      const res = await fetch("/api/meetings/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl, title }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        focusWindow.cancel();
        throw new Error(body.error || "Couldn't send Anchor to that meeting");
      }
      form.reset();
      // Jumps straight to this meeting's own page — that's where meeting
      // mode (the live transcript + coaching panel) actually lives once
      // Anchor's in the call, same as a deal's During tab.
      if (body.meeting?.id) {
        focusWindow.attach(body.meeting.id);
        router.push(`/dashboard/meetings/${body.meeting.id}`);
      } else {
        focusWindow.cancel();
        await refresh();
      }
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Couldn't send Anchor to that meeting");
    } finally {
      setJoining(false);
    }
  }

  async function handleDelete(id: string, title: string) {
    if (
      !window.confirm(
        `Delete "${title}"? This removes the recording, transcript, and summary for good.`
      )
    ) {
      return;
    }
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't delete this recording");
      }
      setMeetings((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete this recording");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-brand">Home</h1>
        <p className="text-sm text-slate-500">
          Send Anchor to a live meeting, record one yourself, or upload a recording — everything
          shows up below once it&apos;s processed.
        </p>
      </div>

      {/* Calendar-matched deal meetings for today, one click away from
          joining — see TodayMeetings.tsx. Renders nothing (not even an
          empty card) on a day with nothing to show, so it doesn't push
          the rest of the page down when it's quiet. */}
      <TodayMeetings />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 border-l-4 border-l-brand bg-white p-6 shadow-sm lg:col-span-2">
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

        <MicRecorderView {...mic} />
      </div>

      <section className="rounded-xl border border-slate-200 border-l-4 border-l-accent bg-white p-6 shadow-sm">
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
            className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
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
              <div key={m.id} className="group relative">
                <Link
                  href={`/dashboard/meetings/${m.id}`}
                  className="card-hover flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 pr-10 shadow-sm hover:border-slate-300"
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
                <button
                  type="button"
                  onClick={() => handleDelete(m.id, m.title)}
                  disabled={deletingId === m.id}
                  aria-label={`Delete ${m.title}`}
                  title="Delete recording"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 group-hover:opacity-100"
                >
                  <TrashIcon />
                </button>
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
