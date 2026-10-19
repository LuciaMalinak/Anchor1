"use client";

import { useLiveMeeting } from "@/lib/useLiveMeeting";
import {
  CallSpeakersRow,
  CallSummary,
  CoachingLists,
  LiveQuestionsBox,
  OffLimitsBox,
  TranscriptStrip,
} from "@/components/LiveCoachingBits";
import { requestFocusWindow } from "@/lib/focusWindowBus";
import { StopMeetingButton } from "@/components/StopMeetingButton";

// Live transcript + AI coaching for a meeting Anchor is actively sitting
// in on (bot status "joining"/"recording"). The actual polling now lives
// in useLiveMeeting (src/lib/useLiveMeeting.ts) — pulled out so the
// focus-mode pop-out window (src/app/focus) can share it instead of
// running a second, independent poll of the same endpoint.
export function LiveMeetingPanel({ meetingId, title }: { meetingId: string; title: string }) {
  const {
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
  } = useLiveMeeting(meetingId);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg bg-brand px-5 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Pops the same live data into its own small window — a real
              always-on-top window (Picture-in-Picture) where the browser
              supports it, an ordinary popup otherwise. See
              useFocusWindow.ts for why the actual window/session is owned
              by a single instance mounted in the dashboard layout
              (LiveMeetingWatcher) rather than here — this just asks for
              it via the bus so a PiP session survives navigating off this
              page, the same way the old plain popup always did. */}
          <button
            type="button"
            onClick={() => requestFocusWindow(meetingId)}
            className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-white/25"
            title="Open a small always-on-top focus window with just the live coaching and Ask Anchor — good for keeping next to Zoom or Teams"
          >
            Focus window ⛶
          </button>
          {/* Ends the meeting early: Anchor's bot leaves a Zoom/Teams call
              (without hanging up for anyone else), or an in-person
              recording stops and gets written up — see stopMeeting.ts.
              Anchor Desktop recordings stop from the desktop app. */}
          <StopMeetingButton meetingId={meetingId} variant="light" inPerson={!hasBot && !isDesktop} desktop={isDesktop} />
          <span className="text-xs text-slate-200">{status === "joining" ? "Joining…" : "Live"}</span>
        </div>
      </div>

      {/* Answers first and biggest — that's what someone on a call needs
          in the moment — then what not to agree to, what's left to
          cover, and short suggestions. The transcript sits underneath,
          small, for when it's needed. */}
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-[1.4fr_1fr]">
        <div className="flex min-w-0 flex-col gap-3">
          <CallSpeakersRow speakers={speakers} onMark={markSpeaker} />
          <LiveQuestionsBox
            current={suggestions?.liveQuestion}
            answered={answered}
            onMarkMe={speakers.length ? (name) => markSpeaker(name, true) : undefined}
            cardClassName="rounded-lg border border-brand/30 bg-brand/5"
            meetingId={meetingId}
          />
          {!suggestions?.liveQuestion && !answered.length && (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-sm text-slate-400">
              When they ask something, the answer shows up here.
            </p>
          )}
          <CallSummary summary={suggestions?.summary} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <OffLimitsBox offLimits={suggestions?.offLimits} decisionBoundaries={decisionBoundaries} />
          <CoachingLists suggestions={suggestions} coachingError={coachingError} coachingRefreshing={coachingRefreshing} />
        </div>
      </div>

      <div className="px-5 pb-4">
        <TranscriptStrip segments={segments} live={status === "recording" || status === "joining"} error={error} />
      </div>
    </div>
  );
}
