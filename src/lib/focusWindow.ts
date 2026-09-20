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
export function openFocusWindow(meetingId: string) {
  const width = 460;
  const height = 720;
  const left = Math.max(0, (window.screen.availWidth - width) / 2);
  const top = Math.max(0, (window.screen.availHeight - height) / 2);
  window.open(
    `/focus/${meetingId}`,
    `anchor-focus-${meetingId}`,
    `width=${width},height=${height},left=${left},top=${top}`
  );
}
