"use client";

import { useEffect, useRef, useState } from "react";

type LiveSegment = {
  id: string;
  speakerName: string | null;
  text: string;
  relativeSeconds: number | null;
};

type LiveSuggestions = {
  nudges: string[];
  checklist: { label: string; covered: boolean }[];
} | null;

const POLL_MS = 4000;

// Live transcript + AI coaching for a meeting Anchor is actively sitting
// in on (bot status "joining"/"recording") — polls /api/meetings/[id]/live,
// which itself debounces the actual coaching regeneration server-side
// (see that route), so polling here just needs to feel responsive.
export function LiveMeetingPanel({ meetingId, title }: { meetingId: string; title: string }) {
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [suggestions, setSuggestions] = useState<LiveSuggestions>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    async function poll() {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(`/api/meetings/${meetingId}/live`);
        if (!res.ok) throw new Error("Couldn't load live updates");
        const body = await res.json();
        setSegments(body.segments || []);
        setSuggestions(body.liveSuggestions || null);
        setStatus(body.status);
        setError(null);
        // Stop polling once the meeting's left the live states — the
        // panel's parent will stop rendering it on the next refresh.
        if (body.status !== "joining" && body.status !== "recording") {
          stoppedRef.current = true;
          return;
        }
      } catch {
        setError("Couldn't reach the live feed — retrying…");
      }
      if (!stoppedRef.current) {
        timer = setTimeout(poll, POLL_MS);
      }
    }

    let timer: ReturnType<typeof setTimeout>;
    poll();
    return () => {
      stoppedRef.current = true;
      clearTimeout(timer);
    };
  }, [meetingId]);

  useEffect(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, [segments.length]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between rounded-t-lg bg-brand px-5 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <span className="text-xs text-slate-200">
          {status === "joining" ? "Joining…" : "Live"}
        </span>
      </div>

      <div className="grid gap-0 sm:grid-cols-[1.3fr_1fr]">
        <div className="flex max-h-72 flex-col overflow-y-auto border-b border-slate-100 px-5 py-4 sm:border-b-0 sm:border-r">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-accent">
            LIVE TRANSCRIPT
          </p>
          {segments.length === 0 ? (
            <p className="text-sm text-slate-500">
              Waiting for the conversation to start — this fills in as people speak.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {segments.map((s) => (
                <p key={s.id} className="text-sm text-slate-700">
                  {s.speakerName && (
                    <span className="font-medium text-slate-900">{s.speakerName}: </span>
                  )}
                  {s.text}
                </p>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
          {error && <p className="mt-2 text-xs text-amber-600">{error}</p>}
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-accent">
              SUGGESTIONS
            </p>
            {!suggestions || suggestions.nudges.length === 0 ? (
              <p className="text-sm text-slate-500">
                {segments.length === 0
                  ? "Nudges show up here once the conversation gets going."
                  : "Nothing urgent right now."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {suggestions.nudges.map((n, i) => (
                  <li
                    key={i}
                    className="rounded-md bg-accent/10 px-3 py-2 text-sm text-slate-800"
                  >
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {suggestions && suggestions.checklist.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-accent">
                TO COVER
              </p>
              <ul className="flex flex-col gap-1.5">
                {suggestions.checklist.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                        c.covered
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {c.covered ? "✓" : ""}
                    </span>
                    <span className={c.covered ? "text-slate-400 line-through" : "text-slate-700"}>
                      {c.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
