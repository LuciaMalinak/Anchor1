"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LiveSegment = {
  id: string;
  speakerName: string | null;
  text: string;
  relativeSeconds: number | null;
};

export type LiveSuggestions = {
  nudges: string[];
  checklist: { label: string; covered: boolean }[];
  // suggestedAnswer is "" while the answer is still being written (see
  // src/lib/liveQuestion.ts) — the question itself shows right away.
  // answering stays true while the answer is still streaming in.
  liveQuestion: {
    question: string;
    suggestedAnswer: string;
    askedAt?: number;
    answering?: boolean;
    askedBy?: string | null;
    links?: LiveLink[];
    caution?: LiveCaution | null;
  } | null;
  // Older rows (and the first moments of a call) don't have these yet.
  summary?: string[];
  offLimits?: { label: string; raised: boolean }[];
} | null;

export type LiveLink = { label: string; url: string };

// red: answering straight would agree to something the person on the
// call can't decide; amber: worth double-checking. See liveQuestion.ts.
export type LiveCaution = { level: "red" | "amber"; reason: string };

// One answered question from earlier in the call (meetings.liveQuestions).
export type AnsweredQuestion = {
  question: string;
  answer: string;
  askedAt: number;
  askedBy: string | null;
  links: LiveLink[];
  caution?: LiveCaution | null;
  feedback?: "up" | "down";
};

// A speaker label on the call, and whether it's the person using Anchor.
export type CallSpeaker = { name: string; isMe: boolean };

// Was 4000ms — the actual transcript segments aren't behind any
// server-side debounce (see the live route's GET handler: it reads
// meetingLiveSegments fresh on every call), so this interval alone was
// the biggest lever on how quickly new words show up on screen.
// Tightened for a snappier "it's really listening" feel; the coaching
// nudges have their own separate server-side throttle (see
// MIN_REFRESH_MS in the live route) so this doesn't multiply AI call
// volume. Dropped from 1500ms to 1000ms so a just-asked question and its
// answer show up as soon as the server has them.
const POLL_MS = 1000;
// While a just-asked question's answer is being written (it streams in —
// see src/lib/liveQuestion.ts), poll much faster so the rep watches it
// appear word by word instead of in one-second jumps.
const FAST_POLL_MS = 300;

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
  const [isDesktop, setIsDesktop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Why live coaching couldn't be generated, from the /live route —
  // null while it's working (or hasn't been tried yet).
  const [coachingError, setCoachingError] = useState<string | null>(null);
  // Whether new suggestions are being generated right now.
  const [coachingRefreshing, setCoachingRefreshing] = useState(false);
  const [answered, setAnswered] = useState<AnsweredQuestion[]>([]);
  const [speakers, setSpeakers] = useState<CallSpeaker[]>([]);
  const [decisionBoundaries, setDecisionBoundaries] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    async function poll() {
      if (stoppedRef.current) return;
      let nextPollMs = POLL_MS;
      try {
        const res = await fetch(`/api/meetings/${meetingId}/live`);
        if (!res.ok) throw new Error("Couldn't load live updates");
        const body = await res.json();
        setSegments(body.segments || []);
        setSuggestions(body.liveSuggestions || null);
        setCoachingError(body.coachingError || null);
        setCoachingRefreshing(body.coachingRefreshing === true);
        setAnswered(Array.isArray(body.liveQuestions) ? body.liveQuestions : []);
        setSpeakers(Array.isArray(body.speakers) ? body.speakers : []);
        setDecisionBoundaries(typeof body.decisionBoundaries === "string" ? body.decisionBoundaries : null);
        const question = body.liveSuggestions?.liveQuestion;
        if (question && (question.answering || !question.suggestedAnswer)) nextPollMs = FAST_POLL_MS;
        setStatus(body.status);
        setHasBot(body.hasBot !== false);
        setIsDesktop(body.isDesktop === true);
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
        timer = setTimeout(poll, nextPollMs);
      }
    }

    let timer: ReturnType<typeof setTimeout>;
    poll();
    return () => {
      stoppedRef.current = true;
      clearTimeout(timer);
    };
  }, [meetingId]);

  // "That's me" / "Not me" on a speaker: remembered for later calls too.
  // Updates the panel straight away rather than waiting for the next poll.
  const markSpeaker = useCallback(
    async (speakerName: string, isMe: boolean) => {
      setSpeakers((list) => list.map((s) => (s.name === speakerName ? { ...s, isMe } : s)));
      if (isMe) {
        setAnswered((list) => list.filter((q) => q.askedBy !== speakerName));
        setSuggestions((cur) => (cur?.liveQuestion?.askedBy === speakerName ? { ...cur, liveQuestion: null } : cur));
      }
      await fetch(`/api/meetings/${meetingId}/live/me`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speakerName, isMe }),
      }).catch(() => {});
    },
    [meetingId]
  );

  return {
    segments,
    suggestions,
    status,
    hasBot,
    isDesktop,
    error,
    coachingError,
    coachingRefreshing,
    answered,
    speakers,
    markSpeaker,
    decisionBoundaries,
  };
}
