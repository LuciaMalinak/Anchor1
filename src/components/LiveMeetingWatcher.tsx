"use client";

import { useEffect, useRef, useState } from "react";
import { useFocusWindow } from "@/lib/useFocusWindow";
import { onFocusWindowRequest, onFocusWindowPendingRequest } from "@/lib/focusWindowBus";

type LiveMeeting = { id: string; title: string; dealId: string | null; status: string };

// How often to check "did anything of mine just go live" — much lighter
// than useLiveMeeting's 1.5s transcript poll, since this only needs to
// notice a NEW live meeting exists at all, not keep up with a
// conversation word-for-word.
const POLL_MS = 5_000;

// Mounted once in the dashboard layout (not the deal page) so a
// scheduled Zoom/Teams call going live surfaces a prompt to open the
// Focus window (see useFocusWindow.ts / src/app/focus) no matter which
// page someone's actually on when it starts — the Deals list, another
// deal entirely, wherever. This is also the ONE place in the app that
// owns a useFocusWindow() session (see that hook's comment) — every other
// "open the Focus window" button (LiveMeetingPanel's, on the deal page)
// goes through requestFocusWindow()/onFocusWindowRequest below instead of
// holding its own session, so a Picture-in-Picture window survives
// navigating around the app.
//
// This can't silently pop the window open with zero interaction —
// browsers block window.open() (and Picture-in-Picture) unless it's the
// direct result of a click, which is exactly why the Focus window has
// only ever opened from a button so far. What this DOES do automatically:
// notice the call went live and immediately show a one-click prompt (plus
// an OS notification, when permitted, whose click also counts as that
// required interaction). The in-app banner below is the reliable path
// either way.
export function LiveMeetingWatcher() {
  const [prompts, setPrompts] = useState<LiveMeeting[]>([]);
  // Meeting ids already surfaced this page load — a meeting still being
  // "live" on the next poll shouldn't re-trigger a second prompt/
  // notification for the same call.
  const seenRef = useRef<Set<string>>(new Set());
  const askedPermissionRef = useRef(false);
  const { open, openPending, portal } = useFocusWindow();

  // Lets a button elsewhere in the app (LiveMeetingPanel's "Focus window"
  // button) ask for the window to open without holding its own session —
  // see the comment above.
  useEffect(() => onFocusWindowRequest(open), [open]);
  // Same idea, for a "Join meeting" click that wants the Focus window to
  // pop open the instant you join, before Anchor even knows which
  // meeting it'll be yet — see openPending()'s own comment and
  // focusWindowBus.ts's requestFocusWindowPending().
  useEffect(() => onFocusWindowPendingRequest(openPending), [openPending]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    function fireNotification(m: LiveMeeting) {
      const n = new Notification(`${m.title} just went live`, {
        body: "Open the Focus window to use Anchor alongside the call.",
        tag: `anchor-live-${m.id}`,
      });
      n.onclick = () => {
        window.focus();
        open(m.id);
        n.close();
      };
    }

    function notify(fresh: LiveMeeting[]) {
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission === "granted") {
        fresh.forEach(fireNotification);
        return;
      }
      // Only ever asked once per page load, and only once something's
      // actually live — asking for notification permission on a page
      // that hasn't given anyone a reason for it yet just trains people
      // to reflexively click "Block."
      if (Notification.permission === "default" && !askedPermissionRef.current) {
        askedPermissionRef.current = true;
        Notification.requestPermission()
          .then((perm) => {
            if (perm === "granted") fresh.forEach(fireNotification);
          })
          .catch(() => {});
      }
    }

    async function poll() {
      if (stopped) return;
      try {
        const res = await fetch("/api/meetings/live-now");
        if (res.ok) {
          const body = await res.json();
          const live: LiveMeeting[] = Array.isArray(body.meetings) ? body.meetings : [];
          const fresh = live.filter((m) => !seenRef.current.has(m.id));
          if (fresh.length > 0) {
            fresh.forEach((m) => seenRef.current.add(m.id));
            setPrompts((prev) => [...prev, ...fresh]);
            notify(fresh);
          }
        }
      } catch {
        // Best-effort — this is a convenience nudge on top of the Focus
        // window button, which still works fine on its own, so a failed
        // poll just quietly tries again next time.
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open]);

  function dismiss(id: string) {
    setPrompts((prev) => prev.filter((m) => m.id !== id));
  }

  function openMeeting(m: LiveMeeting) {
    open(m.id);
    dismiss(m.id);
  }

  // `portal` has to render regardless of whether there's a prompt banner
  // to show — it's how an open Focus window (Picture-in-Picture) session
  // actually gets mounted (see useFocusWindow.ts). Dropping it whenever
  // `prompts` is empty would tear down a session someone opened days ago
  // and is still using.
  return (
    <>
      {portal}
      {prompts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          {prompts.map((m) => (
            <div
              key={m.id}
              className="flex w-80 items-start gap-3 rounded-lg border border-emerald-200 bg-white px-4 py-3 shadow-lg"
            >
              <span
                className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{m.title} just went live</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Open the Focus window to use Anchor alongside the call.
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => openMeeting(m)}
                    className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90"
                  >
                    Open Focus window
                  </button>
                  <button
                    type="button"
                    onClick={() => dismiss(m.id)}
                    className="text-xs font-medium text-slate-400 hover:text-slate-600"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
