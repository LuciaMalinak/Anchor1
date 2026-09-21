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
const PENDING_EVENT = "anchor-focus-window-open-pending";

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

export type PendingFocusWindow = {
  // Fills the already-open window in with a real meeting once its id is
  // known — call once, after the join request resolves.
  attach: (meetingId: string) => void;
  // Closes the pre-opened window instead — call if the join never
  // actually happens (a validation error, a 409, etc.).
  cancel: () => void;
};

const NOOP_PENDING: PendingFocusWindow = { attach: () => {}, cancel: () => {} };

// Opens the Focus window RIGHT NOW, before the caller knows which meeting
// it's for — browsers only allow a Picture-in-Picture window to open as
// the direct, synchronous result of a click (see useFocusWindow.ts's
// comment on transient activation), and by the time a "Join meeting"
// click's own fetch to /api/meetings/join resolves with a real meeting
// id, that window of opportunity has already closed. Calling this
// synchronously inside the click handler — before any `await` — opens a
// blank/loading window while that's still true, then `attach(meetingId)`
// fills it in once the join call actually returns one.
//
// Uses the same synchronous EventTarget dispatch as requestFocusWindow
// above: the single owning useFocusWindow() instance (LiveMeetingWatcher)
// mutates `handle` in place during dispatchEvent, so by the time this
// function returns, `handle.attach`/`handle.cancel` are already the real
// ones — no race, nothing to await.
export function requestFocusWindowPending(): PendingFocusWindow {
  const handle: PendingFocusWindow = { ...NOOP_PENDING };
  bus.dispatchEvent(new CustomEvent<PendingFocusWindow>(PENDING_EVENT, { detail: handle }));
  return handle;
}

export function onFocusWindowPendingRequest(handler: () => PendingFocusWindow) {
  function listener(e: Event) {
    const passed = (e as CustomEvent<PendingFocusWindow>).detail;
    const real = handler();
    passed.attach = real.attach;
    passed.cancel = real.cancel;
  }
  bus.addEventListener(PENDING_EVENT, listener);
  return () => bus.removeEventListener(PENDING_EVENT, listener);
}
