"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LiveSuggestions } from "@/lib/useLiveMeeting";

// Two ways to watch live coaching during a call:
//   "listening"  — everything, as it comes in (the original view). Good
//                  when the other side is doing most of the talking.
//   "presenting" — a glanceable view for when you're the one talking: the
//                  answer cut to one short line in big type, at most three
//                  high-level bullets, and both held on screen long enough
//                  to read with a glance instead of changing every second.
// The choice is per person, per device, and shared by the During tab's
// live panel and the Focus window (same origin, same localStorage) —
// including the Anchor Desktop overlay, which loads the Focus window.
export type LiveView = "listening" | "presenting";

const STORAGE_KEY = "anchor.liveView";
// Same-window listeners: the Picture-in-Picture focus window runs in the
// opener's JS realm, so a `storage` event (other windows only) wouldn't
// reach it.
const CHANGE_EVENT = "anchor:live-view";

function readView(): LiveView {
  try {
    return localStorage.getItem(STORAGE_KEY) === "presenting" ? "presenting" : "listening";
  } catch {
    return "listening";
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function useLiveView(): [LiveView, (next: LiveView) => void] {
  const view = useSyncExternalStore(subscribe, readView, () => "listening" as LiveView);
  const setView = useCallback((next: LiveView) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [view, setView];
}

// How long something stays up in the presenting view before a newer
// version may replace it.
export const PRESENTING_ANSWER_HOLD_MS = 15_000;
export const PRESENTING_BULLETS_HOLD_MS = 60_000;

// Keeps `value` on screen for at least `holdMs` once shown: a value with
// a new `key` only replaces the shown one after the hold runs out. While
// the key stays the same, the latest value passes straight through (an
// answer that finished writing, say). The first value, and anything
// replacing an empty placeholder (key ""), shows at once.
export function useHeld<T>(value: T, key: string, holdMs: number): T {
  const [shown, setShown] = useState<{ key: string; value: T }>({ key, value });
  const shownAtRef = useRef(0);

  useEffect(() => {
    if (key === shown.key) return;
    // Nothing on screen yet (an empty key is a placeholder): no wait.
    const wait = shown.key ? Math.max(0, shownAtRef.current + holdMs - Date.now()) : 0;
    const t = setTimeout(() => {
      shownAtRef.current = Date.now();
      setShown({ key, value });
    }, wait);
    return () => clearTimeout(t);
  }, [key, value, shown.key, holdMs]);

  // Starts the hold for the very first thing shown.
  useEffect(() => {
    if (shown.key && !shownAtRef.current) shownAtRef.current = Date.now();
  }, [shown.key]);

  return key === shown.key ? value : shown.value;
}

const HEADLINE_MAX_WORDS = 18;

// The first sentence of an answer, capped at a few words: something you
// can take in mid-sentence. The full answer stays in the listening view.
export function headlineOf(answer: string): string {
  const text = answer.trim().replace(/\s+/g, " ");
  if (!text) return "";
  const match = text.match(/^.+?[.!?](?=\s|$)/);
  const first = match ? match[0] : text;
  const words = first.split(" ");
  if (words.length <= HEADLINE_MAX_WORDS) return first;
  return `${words.slice(0, HEADLINE_MAX_WORDS).join(" ").replace(/[,;:—-]+$/, "")}…`;
}

const BULLET_MAX_WORDS = 10;

function shorten(text: string): string {
  const words = text.trim().replace(/\s+/g, " ").split(" ");
  if (words.length <= BULLET_MAX_WORDS) return words.join(" ");
  return `${words.slice(0, BULLET_MAX_WORDS).join(" ").replace(/[,;:—-]+$/, "")}…`;
}

export type GlanceBullet = { kind: "cover" | "nudge"; text: string };

// At most three high-level bullets: the next couple of things still to
// cover, then the single top suggestion. "Don't agree to" items they've
// actually asked about are shown separately (and at once), not here.
export function glanceBullets(suggestions: LiveSuggestions): GlanceBullet[] {
  if (!suggestions) return [];
  const bullets: GlanceBullet[] = [];
  for (const c of suggestions.checklist ?? []) {
    if (c.covered) continue;
    bullets.push({ kind: "cover", text: shorten(c.label) });
    if (bullets.length === 2) break;
  }
  const nudge = suggestions.nudges?.[0];
  if (nudge) bullets.push({ kind: "nudge", text: shorten(nudge) });
  return bullets.slice(0, 3);
}
