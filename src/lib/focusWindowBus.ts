"use client";

// Tiny pub/sub so any button anywhere in the app (the During tab's
// "Focus window" button, the dashboard-wide "just went live" banner) can
// ask for the Focus window to open, while the actual window/Picture-in-
// Picture session is owned by exactly one instance of useFocusWindow
// (mounted once in LiveMeetingWatcher — see src/app/dashboard/layout.tsx
// and src/lib/useFocusWindow.ts for why one owner matters: it's what lets
// an always-on-top session survive navigating between pages instead of
// closing whenever the button that opened it unmounts).
const bus = new EventTarget();
const EVENT = "anchor-focus-window-open";

export function requestFocusWindow(meetingId: string) {
  bus.dispatchEvent(new CustomEvent<string>(EVENT, { detail: meetingId }));
}

export function onFocusWindowRequest(handler: (meetingId: string) => void) {
  function listener(e: Event) {
    handler((e as CustomEvent<string>).detail);
  }
  bus.addEventListener(EVENT, listener);
  return () => bus.removeEventListener(EVENT, listener);
}
