"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestFocusWindowPending } from "@/lib/focusWindowBus";

type TodayMeeting = {
  eventId: string;
  summary: string;
  start: string;
  joinUrl: string | null;
  dealId: string;
  dealName: string;
};

// "Today" to-do list on the Home page: a calendar invite tied to a deal
// Anchor already knows (matched by attendee email against that deal's
// contacts, same signal calendarContext already uses — see
// /api/meetings/today) shows up here automatically. The server fetches a
// window generous enough to cover any timezone; this narrows it down to
// "actually today" using the browser's own local clock, since nothing in
// Anchor stores a user's timezone.
//
// One click both opens the real Zoom/Meet/Teams page (so the person
// joins as themselves) and sends Anchor's bot into the same meeting,
// pre-filled from the invite — then lands on that deal, which puts you
// straight into meeting mode (During tab) the moment Anchor's actually
// in the call. Google Calendar only for now — Outlook/Teams calendar
// reading isn't wired up yet even though the connection itself exists.
export function TodayMeetings() {
  const router = useRouter();
  const [meetings, setMeetings] = useState<TodayMeeting[] | null>(null);
  const [googleConnected, setGoogleConnected] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/meetings/today")
      .then((res) => (res.ok ? res.json() : { meetings: [], googleConnected: true }))
      .then((body) => {
        if (cancelled) return;
        setMeetings(Array.isArray(body.meetings) ? body.meetings : []);
        setGoogleConnected(body.googleConnected !== false);
      })
      .catch(() => {
        if (!cancelled) setMeetings([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const todays = (meetings ?? []).filter((m) => {
    const d = new Date(m.start);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  });

  async function join(m: TodayMeeting) {
    if (!m.joinUrl) return;
    setJoiningId(m.eventId);
    setError(null);
    // Opens the real meeting as its own step (not gated on the API call
    // below) — this is a direct click, so it's a genuine user gesture and
    // won't get popup-blocked; waiting on the fetch first risked losing
    // that.
    window.open(m.joinUrl, "_blank", "noopener,noreferrer");
    // Opens the Focus window right now, in this same click — see
    // requestFocusWindowPending()'s comment for why it can't wait for
    // the fetch below to come back with a meeting id first.
    const focusWindow = requestFocusWindowPending();
    try {
      const res = await fetch("/api/meetings/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl: m.joinUrl, title: m.summary, dealId: m.dealId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Anchor's already in a live meeting for this deal (a double
        // click, or clicking this same entry again after already
        // joining it) — the most useful thing to do is take her straight
        // to it rather than just report the conflict.
        if (res.status === 409 && body.meeting?.dealId) {
          if (body.meeting?.id) focusWindow.attach(body.meeting.id);
          else focusWindow.cancel();
          router.push(`/dashboard/deals/${body.meeting.dealId}`);
          return;
        }
        focusWindow.cancel();
        throw new Error(body.error || "Couldn't send Anchor to that meeting");
      }
      if (body.meeting?.id) focusWindow.attach(body.meeting.id);
      else focusWindow.cancel();
      router.push(`/dashboard/deals/${m.dealId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send Anchor to that meeting");
      setJoiningId(null);
    }
  }

  // Nothing to show and nothing wrong — don't clutter the Home page with
  // an empty "Today" card on a day with no deal meetings.
  if (meetings !== null && todays.length === 0 && googleConnected) return null;

  return (
    <section className="rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-medium text-slate-900">Today</h2>
      {!googleConnected ? (
        <p className="mt-1 text-sm text-slate-500">
          Connect your Google Calendar to have today&apos;s deal meetings show up here
          automatically —{" "}
          <Link href="/dashboard/integrations" className="font-medium text-brand hover:underline">
            connect it on the Integrations page
          </Link>
          .
        </p>
      ) : meetings === null ? (
        <p className="mt-1 text-sm text-slate-400">Checking your calendar…</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-500">
            From your calendar, matched to a deal by who&apos;s on the invite.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {todays.map((m) => (
              <div
                key={m.eventId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{m.summary}</p>
                  <p className="text-xs text-slate-500">
                    {m.dealName} ·{" "}
                    {new Date(m.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    {!m.joinUrl && " · no meeting link found on the invite"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => join(m)}
                  disabled={joiningId === m.eventId || !m.joinUrl}
                  title={
                    m.joinUrl
                      ? "Opens the meeting and sends Anchor in"
                      : "No Zoom/Meet/Teams link found on this invite — paste it below instead"
                  }
                  className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                >
                  {joiningId === m.eventId ? "Joining…" : m.joinUrl ? "Join now" : "No link found"}
                </button>
              </div>
            ))}
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </>
      )}
    </section>
  );
}
