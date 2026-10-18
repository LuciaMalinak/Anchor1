"use client";

import type { AnsweredQuestion, CallSpeaker, LiveLink, LiveSuggestions } from "@/lib/useLiveMeeting";

type LiveQuestion = NonNullable<NonNullable<LiveSuggestions>["liveQuestion"]>;

function QuestionLinks({ links }: { links?: LiveLink[] }) {
  if (!links?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {links.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-brand/30 bg-white px-2 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/10"
        >
          {l.label} ↗
        </a>
      ))}
    </div>
  );
}

function AskedBy({ name, onMarkMe }: { name?: string | null; onMarkMe?: (name: string) => void }) {
  if (!name) return null;
  return (
    <span className="text-[11px] text-slate-400">
      {name}
      {onMarkMe && (
        <>
          {" · "}
          <button type="button" onClick={() => onMarkMe(name)} className="underline decoration-dotted hover:text-slate-600">
            That&apos;s me
          </button>
        </>
      )}
    </span>
  );
}

// The "THEY JUST ASKED" card, shared by the During tab's live panel and
// the Focus window. The answer streams in (see src/lib/liveQuestion.ts),
// so while it's still being written it shows with a blinking cursor
// rather than popping in all at once.
export function LiveQuestionCard({
  question,
  className,
  onMarkMe,
}: {
  question: LiveQuestion;
  className: string;
  onMarkMe?: (name: string) => void;
}) {
  const writing = question.answering === true || !question.suggestedAnswer;
  return (
    <div className={className}>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.15em] text-brand">
        THEY JUST ASKED
        {writing && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />}
        <span className="ml-auto font-normal tracking-normal">
          <AskedBy name={question.askedBy} onMarkMe={onMarkMe} />
        </span>
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
      {!writing && <QuestionLinks links={question.links} />}
    </div>
  );
}

// Every question the other side asked this call: the newest on top as
// the "THEY JUST ASKED" card, the rest below so earlier answers stay put.
export function LiveQuestionsBox({
  current,
  answered,
  onMarkMe,
  cardClassName,
}: {
  current: LiveQuestion | null | undefined;
  answered: AnsweredQuestion[];
  onMarkMe?: (name: string) => void;
  cardClassName: string;
}) {
  const earlier = answered.filter((q) => q.askedAt !== current?.askedAt).reverse();
  if (!current && !earlier.length) return null;
  return (
    <div className="space-y-2">
      {current && <LiveQuestionCard question={current} className={cardClassName} onMarkMe={onMarkMe} />}
      {earlier.length > 0 && (
        <details open={!current} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold tracking-[0.15em] text-slate-500">
            EARLIER QUESTIONS ({earlier.length})
          </summary>
          <ul className="mt-2 max-h-72 space-y-3 overflow-y-auto">
            {earlier.map((q) => (
              <li key={q.askedAt}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs italic text-slate-500">&ldquo;{q.question}&rdquo;</p>
                  <AskedBy name={q.askedBy} onMarkMe={onMarkMe} />
                </div>
                <p className="mt-0.5 text-sm text-slate-800">{q.answer}</p>
                <QuestionLinks links={q.links} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// Who's who on the call: the person using Anchor taps their own name once
// (remembered for later calls), so only the other side's questions get
// answered. Not shown for an in-person recording, which has no names.
export function CallSpeakersRow({
  speakers,
  onMark,
}: {
  speakers: CallSpeaker[];
  onMark: (name: string, isMe: boolean) => void;
}) {
  if (!speakers.length) return null;
  const someoneIsMe = speakers.some((s) => s.isMe);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-slate-400">{someoneIsMe ? "Who's who:" : "Which one is you? Tap your name:"}</span>
      {speakers.map((s) => (
        <button
          key={s.name}
          type="button"
          onClick={() => onMark(s.name, !s.isMe)}
          title={s.isMe ? "Marked as you. Tap if that's wrong" : "Tap if this is you"}
          className={
            s.isMe
              ? "rounded-full bg-brand px-2 py-0.5 font-medium text-white"
              : "rounded-full border border-slate-300 px-2 py-0.5 text-slate-600 hover:border-brand hover:text-brand"
          }
        >
          {s.name}
          {s.isMe ? " · you" : ""}
        </button>
      ))}
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
