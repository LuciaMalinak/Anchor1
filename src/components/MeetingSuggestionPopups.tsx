"use client";

import { useEffect, useState } from "react";
import { MeetingDecision } from "@/components/MeetingDecision";

type Pending = { threadId: string; fromName: string; deal: string | null; title: string; when: string };

const HIDDEN_KEY = "anchor.meetingPopups.hidden";

function hiddenIds(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(HIDDEN_KEY) || "[]");
  } catch {
    return [];
  }
}

// Little pop-ups across Anchor for times someone suggested by email (from
// the latest Morning brief): "Dana suggested Thu 10:00 — Approve /
// Decline", then Google Calendar, Apple / iPhone or both. "Later" hides one
// for this browser session; it comes back until approved or declined.
export function MeetingSuggestionPopups() {
  const [pending, setPending] = useState<Pending[]>([]);

  useEffect(() => {
    fetch("/api/morning-brief/pending")
      .then((r) => (r.ok ? r.json() : { meetings: [] }))
      .then((body) => {
        const hidden = new Set(hiddenIds());
        setPending((body.meetings as Pending[]).filter((m) => !hidden.has(m.threadId)));
      })
      .catch(() => {});
  }, []);

  function hide(threadId: string) {
    setPending((list) => list.filter((m) => m.threadId !== threadId));
    try {
      sessionStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenIds(), threadId]));
    } catch {
      // Private mode: just hidden for now.
    }
  }

  if (!pending.length) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-2">
      {pending.slice(0, 3).map((m) => (
        <div key={m.threadId} className="w-80 max-w-full rounded-lg border border-sky-200 bg-white px-4 py-3 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-700">Meeting request{m.deal ? ` · ${m.deal}` : ""}</p>
            <button type="button" onClick={() => hide(m.threadId)} className="text-xs text-slate-400 hover:text-slate-600">
              Later
            </button>
          </div>
          <div className="mt-1">
            <MeetingDecision
              compact
              threadId={m.threadId}
              fromName={m.fromName}
              title={m.title}
              when={m.when}
              onDone={() => setTimeout(() => setPending((list) => list.filter((x) => x.threadId !== m.threadId)), 2500)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
