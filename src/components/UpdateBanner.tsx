"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// "A new version of Anchor is available" — the website-side half of the
// auto-update mechanism (see desktop/src/main.ts's initAutoUpdate for the
// desktop app's own, fully-silent half). The website itself always serves
// the latest code to a fresh page load; this banner only exists for
// someone who already has a tab open from BEFORE a deploy went live —
// their tab is still running old JS until they refresh.
//
// Polls GET /api/version (see src/lib/appVersion.ts) every 5 minutes, plus
// once whenever the tab comes back into focus (the common case: someone
// left a tab open overnight, comes back, we want the check to feel prompt
// rather than waiting out a fixed interval). Compares against the version
// this page itself was served with — captured once on mount, never
// re-read — so the banner shows exactly when those two disagree.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function UpdateBanner({ initialVersion }: { initialVersion: string }) {
  const pathname = usePathname();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const checkingRef = useRef(false);
  // The desktop app's Focus overlay loads this route live inside its own
  // small Electron BrowserWindow (see focus/[meetingId]/page.tsx) — it's
  // not a browser tab someone leaves open across deploys, and a "refresh"
  // banner has no good place to sit in that compact layout. Desktop
  // updates are handled entirely by desktop/src/main.ts's own mechanism.
  const isFocusOverlay = pathname?.startsWith("/focus/");

  useEffect(() => {
    if (isFocusOverlay) return;

    async function check() {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        if (body?.version && body.version !== initialVersion) {
          setUpdateAvailable(true);
        }
      } catch {
        // Offline or a blip — just try again on the next interval/focus.
      } finally {
        checkingRef.current = false;
      }
    }

    const interval = setInterval(check, POLL_INTERVAL_MS);
    const onFocus = () => check();
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [initialVersion, isFocusOverlay]);

  if (isFocusOverlay || !updateAvailable || dismissed) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 border-t border-brand-dark bg-brand px-4 py-2.5 text-sm text-white shadow-lg">
      <span>A new version of Anchor is available.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition hover:bg-accent-dark"
      >
        Refresh
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="ml-1 text-white/60 transition hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}
