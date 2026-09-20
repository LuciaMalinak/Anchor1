"use client";

import { useEffect, useRef } from "react";
import { useLiveMeeting } from "@/lib/useLiveMeeting";
import { openFocusWindow } from "@/lib/focusWindow";

// Live transcript + AI coaching for a meeting Anchor is actively sitting
// in on (bot status "joining"/"recording"). The actual polling now lives
// in useLiveMeeting (src/lib/useLiveMeeting.ts) — pulled out so the
// focus-mode pop-out window (src/app/focus) can share it instead of
// running a second, independent poll of the same endpoint.
export function LiveMeetingPanel({ meetingId, title }: { meetingId: string; title: string }) {
  const { segments, suggestions, status, error } = useLiveMeeting(meetingId);
  const bottomRef = useRef<HTMLDivElement>(null);

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
        <div className="flex items-center gap-3">
          {/* Pops the same live data into its own small window — see
              openFocusWindow's comment for why this is a real popup
              rather than an in-page overlay: it's meant to sit on a
              second monitor next to the actual call, showing only
              whichever widgets this person has chosen to keep (see
              src/app/focus/[meetingId]), not the rest of the deal page. */}
          <button
            type="button"
            onClick={() => openFocusWindow(meetingId)}
            className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-white/25"
            title="Open a small focus window with just the live coaching and Ask Anchor — good for a second monitor"
          >
            Focus window ⛶
          </button>
          <span className="text-xs text-slate-200">{status === "joining" ? "Joining…" : "Live"}</span>
        </div>
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
          {suggestions?.liveQuestion && (
            <div className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-3">
              <p className="mb-1 text-[11px] font-semibold tracking-[0.15em] text-brand">
                THEY JUST ASKED
              </p>
              <p className="text-xs italic text-slate-500">
                &ldquo;{suggestions.liveQuestion.question}&rdquo;
              </p>
              <p className="mt-1.5 text-sm font-medium text-slate-900">
                {suggestions.liveQuestion.suggestedAnswer}
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-accent">
              SUGGESTIONS
            </p>
            {!suggestions ? (
              <p className="text-sm text-slate-500">Preparing suggestions…</p>
            ) : suggestions.nudges.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nothing to go on yet for this deal — no prep notes, history, or conversation so
                far. This fills in the moment any of those show up.
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
