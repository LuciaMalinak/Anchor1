"use client";

import { useSyncExternalStore } from "react";

// Whether this visitor is on a Mac, for Mac-vs-Windows details like ⌘K
// versus Ctrl K and which desktop download to put first. Null on the
// server and during hydration, where it can't be known; callers fall back
// to a neutral default until the browser answers.
export function useIsMac(): boolean | null {
  return useSyncExternalStore(subscribe, readIsMac, () => null);
}

function subscribe() {
  return () => {};
}

function readIsMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}
