"use client";

import type { LiveSuggestions } from "@/lib/useLiveMeeting";

type LiveQuestion = NonNullable<NonNullable<LiveSuggestions>["liveQuestion"]>;

// The "THEY JUST ASKED" card, shared by the During tab's live panel and
// the Focus window. The answer streams in (see src/lib/liveQuestion.ts),
// so while it's still being written it shows with a blinking cursor
// rather than popping in all at once.
export function LiveQuestionCard({ question, className }: { question: LiveQuestion; className: string }) {
  const writing = question.answering === true || !question.suggestedAnswer;
  return (
    <div className={className}>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.15em] text-brand">
        THEY JUST ASKED
        {writing && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />}
      </p>
      <p className="text-xs italic text-slate-500">&ldquo;{question.question}&rdquo;</p>
      <p className="mt-1.5 text-sm font-medium text-slate-900">
        {question.suggestedAnswer ? (
          <>
            {question.suggestedAnswer}
            {writing && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-slate-400 align-middle" />}
          </>
        ) : (
          <span className="font-normal text-slate-500">Writing an answer…</span>
        )}
      </p>
    </div>
  );
}

// Small "updating" hint next to the SUGGESTIONS heading while a refresh
// is running, so the rep can see Anchor is reacting to what was just said.
export function UpdatingBadge({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle text-[10px] font-medium tracking-normal text-slate-400">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
      updating
    </span>
  );
}

// Shown under the live transcript so it's obvious Anchor is listening
// even between lines (speech-to-text only sends a line once the speaker
// pauses).
export function ListeningIndicator() {
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
      <span className="flex items-end gap-0.5">
        <span className="h-1.5 w-0.5 animate-pulse rounded bg-emerald-400" />
        <span className="h-2.5 w-0.5 animate-pulse rounded bg-emerald-400 [animation-delay:150ms]" />
        <span className="h-2 w-0.5 animate-pulse rounded bg-emerald-400 [animation-delay:300ms]" />
      </span>
      Listening
    </p>
  );
}
