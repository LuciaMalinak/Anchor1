"use client";

// Opens (or refocuses) the standalone focus-mode window for a live
// meeting — see src/app/focus/[meetingId]. A real popped-out browser
// window rather than an in-page overlay, deliberately: the whole point is
// to put it on a second monitor next to the actual video call, so it has
// to be able to sit there as its own window, not just a panel inside the
// same tab as everything else on the deal page.
//
// Naming the window "anchor-focus-<meetingId>" means clicking the button
// again brings the same window forward instead of opening a duplicate —
// window.open reuses any existing window with a matching name.
const WIDTH = 460;
const HEIGHT = 720;

function popupFeatures(): string {
  const left = Math.max(0, (window.screen.availWidth - WIDTH) / 2);
  const top = Math.max(0, (window.screen.availHeight - HEIGHT) / 2);
  return `width=${WIDTH},height=${HEIGHT},left=${left},top=${top}`;
}

export function openFocusWindow(meetingId: string) {
  window.open(`/focus/${meetingId}`, `anchor-focus-${meetingId}`, popupFeatures());
}

// The popup equivalent of useFocusWindow.ts's openPending() — for a
// browser without Picture-in-Picture (Safari, older Chrome/Firefox).
// window.open() needs the same fresh, synchronous user gesture PiP does:
// called after an `await` (e.g. once a "Join meeting" click's own fetch
// comes back with a meeting id), most browsers' popup blockers silently
// swallow it. Opening a blank window right now, then pointing it at the
// real meeting once the id is known, keeps the actual window.open() call
// inside the click instead of after it.
export function openFocusWindowPending(): { attach: (meetingId: string) => void; cancel: () => void } {
  const popup = window.open("about:blank", "", popupFeatures());
  return {
    attach: (meetingId: string) => {
      if (!popup || popup.closed) {
        // Blocked outright even for the blank window (rare, but
        // possible under a strict popup blocker) — try the direct path
        // anyway; if that's blocked too, at least the During tab still
        // shows the same live view.
        openFocusWindow(meetingId);
        return;
      }
      popup.location.href = `/focus/${meetingId}`;
    },
    cancel: () => {
      if (popup && !popup.closed) popup.close();
    },
  };
}
