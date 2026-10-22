"use client";

import { useEffect, useState } from "react";
import { MeetingDecision } from "@/components/MeetingDecision";

type Pending = { source: "email" | "slack"; id: string; fromName: string; deal: string | null; title: string; when: string };

const HIDDEN_KEY = "anchor.meetingPopups.hidden";

function hiddenIds(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(HIDDEN_KEY) || "[]");
  } catch {
    return [];
  }
}

// Little pop-ups across Anchor for meetings someone asked for, by email
// (from the latest Morning brief) or in Slack: "Dana suggested Thu 10:00 —
// Set it up / Decline", then how to meet (Google Meet, Zoom, Teams, in
// person) and who to invite. "Later" hides one for this browser session;
// it comes back until set up or declined.
export function MeetingSuggestionPopups() {
  const [pending, setPending] = useState<Pending[]>([]);

  useEffect(() => {
    fetch("/api/morning-brief/pending")
      .then((r) => (r.ok ? r.json() : { meetings: [] }))
      .then((body) => {
        const hidden = new Set(hiddenIds());
        setPending((body.meetings as Pending[]).filter((m) => !hidden.has(m.id)));
      })
      .catch(() => {});
  }, []);

  function hide(id: string) {
    setPending((list) => list.filter((m) => m.id !== id));
    try {
      sessionStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenIds(), id]));
    } catch {
      // Private mode: just hidden for now.
    }
  }

  if (!pending.length) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-2">
      {pending.slice(0, 3).map((m) => (
        <div key={m.id} className="max-h-[80vh] w-80 max-w-full overflow-y-auto rounded-lg border border-sky-200 bg-white px-4 py-3 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-700">
              Meeting request{m.source === "slack" ? " · Slack" : ""}
              {m.deal ? ` · ${m.deal}` : ""}
            </p>
            <button type="button" onClick={() => hide(m.id)} className="text-xs text-slate-400 hover:text-slate-600">
              Later
            </button>
          </div>
          <div className="mt-1">
            <MeetingDecision
              compact
              source={m.source}
              threadId={m.id}
              fromName={m.fromName}
              title={m.title}
              when={m.when}
              onDone={() => setTimeout(() => setPending((list) => list.filter((x) => x.id !== m.id)), 4000)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
