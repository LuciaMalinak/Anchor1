"use client";

import { useEffect, useRef, useState } from "react";

export type LiveSegment = {
  id: string;
  speakerName: string | null;
  text: string;
  relativeSeconds: number | null;
};

export type LiveSuggestions = {
  nudges: string[];
  checklist: { label: string; covered: boolean }[];
  liveQuestion: { question: string; suggestedAnswer: string } | null;
} | null;

// Was 4000ms — the actual transcript segments aren't behind any
// server-side debounce (see the live route's GET handler: it reads
// meetingLiveSegments fresh on every call), so this interval alone was
// the biggest lever on how quickly new words show up on screen.
// Tightened for a snappier "it's really listening" feel; the coaching
// nudges have their own separate, longer server-side debounce (see
// COACHING_REFRESH_MS in the live route) so this doesn't multiply AI
// call volume.
const POLL_MS = 1500;

// Polls /api/meetings/[id]/live for the transcript + AI coaching of a
// meeting Anchor is actively sitting in on. Pulled out of
// LiveMeetingPanel.tsx so the focus-mode pop-out window (src/app/focus)
// can show the same live data in a different layout without polling the
// same endpoint twice from two independent copies of this logic.
export function useLiveMeeting(meetingId: string) {
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [suggestions, setSuggestions] = useState<LiveSuggestions>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Whether Anchor's bot actually joined this call (Zoom/Teams) vs. an
  // in-person recording — see the /live route's comment. Defaults true
  // so the Stop button doesn't flash in and immediately disappear while
  // this is still loading (the common case).
  const [hasBot, setHasBot] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    async function poll() {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(`/api/meetings/${meetingId}/live`);
        if (!res.ok) throw new Error("Couldn't load live updates");
        const body = await res.json();
        setSegments(body.segments || []);
        setSuggestions(body.liveSuggestions || null);
        setStatus(body.status);
        setHasBot(body.hasBot !== false);
        setError(null);
        // Stop polling once the meeting's left the live states — the
        // caller decides what to show once that happens.
        if (body.status !== "joining" && body.status !== "recording") {
          stoppedRef.current = true;
          return;
        }
      } catch {
        setError("Couldn't reach the live feed — retrying…");
      }
      if (!stoppedRef.current) {
        timer = setTimeout(poll, POLL_MS);
      }
    }

    let timer: ReturnType<typeof setTimeout>;
    poll();
    return () => {
      stoppedRef.current = true;
      clearTimeout(timer);
    };
  }, [meetingId]);

  return { segments, suggestions, status, hasBot, error };
}
