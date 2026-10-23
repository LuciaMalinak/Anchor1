"use client";

import { useState } from "react";
import type { AnsweredQuestion, CallSpeaker, LiveCaution, LiveLink, LiveSuggestions } from "@/lib/useLiveMeeting";

type LiveQuestion = NonNullable<NonNullable<LiveSuggestions>["liveQuestion"]>;

// Colors for an answer that touches what the person on the call can't
// agree to (red) or should double-check (amber).
const CAUTION_STYLE: Record<LiveCaution["level"], { card: string; badge: string; label: string }> = {
  red: {
    card: "rounded-lg border-2 border-red-300 bg-red-50",
    badge: "bg-red-600 text-white",
    label: "Don't agree — defer it",
  },
  amber: {
    card: "rounded-lg border-2 border-amber-300 bg-amber-50",
    badge: "bg-amber-500 text-white",
    label: "Check before promising",
  },
};

function CautionBadge({ caution }: { caution?: LiveCaution | null }) {
  if (!caution) return null;
  const style = CAUTION_STYLE[caution.level];
  return (
    <p className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>{style.label}</span>
      {caution.reason && <span className={caution.level === "red" ? "text-red-800" : "text-amber-800"}>{caution.reason}</span>}
    </p>
  );
}

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
  meetingId,
  feedback,
}: {
  question: LiveQuestion;
  className: string;
  onMarkMe?: (name: string) => void;
  meetingId?: string;
  feedback?: "up" | "down";
}) {
  const writing = question.answering === true || !question.suggestedAnswer;
  const caution = question.caution;
  return (
    <div className={`${caution ? CAUTION_STYLE[caution.level].card : className} px-3 py-3`}>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.15em] text-brand">
        THEY JUST ASKED
        {writing && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />}
        <span className="ml-auto font-normal tracking-normal">
          <AskedBy name={question.askedBy} onMarkMe={onMarkMe} />
        </span>
      </p>
      <p className="text-xs italic text-slate-500">&ldquo;{question.question}&rdquo;</p>
      <div className="mt-1.5">
        <CautionBadge caution={caution} />
      </div>
      <p className="text-base font-semibold leading-snug text-slate-900">
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
      {!writing && meetingId && question.askedAt != null && (
        <AnswerFeedback meetingId={meetingId} askedAt={question.askedAt} initial={feedback} />
      )}
    </div>
  );
}

// Thumbs up / down on an answer. Up keeps it as the team's answer to that
// question; down asks what it should have said and keeps that instead —
// both go into Anchor's playbook, which the next answers use.
export function AnswerFeedback({
  meetingId,
  askedAt,
  initial,
}: {
  meetingId: string;
  askedAt: number;
  initial?: "up" | "down";
}) {
  const [rating, setRating] = useState<"up" | "down" | undefined>(initial);
  const [fixing, setFixing] = useState(false);
  const [correction, setCorrection] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function send(next: "up" | "down", text?: string) {
    setState("saving");
    const res = await fetch(`/api/meetings/${meetingId}/live-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ askedAt, rating: next, correction: text || undefined }),
    }).catch(() => null);
    if (!res?.ok) {
      setState("error");
      return;
    }
    setRating(next);
    setFixing(false);
    setState("saved");
  }

  const btn = "rounded px-1.5 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-50";
  return (
    <div className="mt-2 text-xs text-slate-500">
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="Good answer — answer like this next time"
          disabled={state === "saving"}
          onClick={() => send("up")}
          className={`${btn} ${rating === "up" ? "bg-emerald-50 text-emerald-700" : ""}`}
        >
          👍
        </button>
        <button
          type="button"
          title="Not right — tell Anchor what to say instead"
          disabled={state === "saving"}
          onClick={() => setFixing((f) => !f)}
          className={`${btn} ${rating === "down" ? "bg-red-50 text-red-700" : ""}`}
        >
          👎
        </button>
        {state === "saved" && (
          <span className="text-emerald-700">{rating === "up" ? "Anchor will answer like this." : "Thanks — Anchor learned that."}</span>
        )}
        {state === "error" && <span className="text-red-600">Couldn&apos;t save — try again.</span>}
      </div>
      {fixing && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <textarea
            autoFocus
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            rows={2}
            placeholder="What should Anchor have said? (optional)"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 outline-none focus:border-brand"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={state === "saving"}
              onClick={() => send("down", correction.trim())}
              className="rounded-md bg-brand px-2.5 py-1 font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {correction.trim() ? "Teach Anchor" : "Just mark it wrong"}
            </button>
            <button type="button" onClick={() => setFixing(false)} className="text-slate-400 hover:text-slate-600">
              Cancel
            </button>
          </div>
        </div>
      )}
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
  meetingId,
  minimizeRecent,
}: {
  current: LiveQuestion | null | undefined;
  answered: AnsweredQuestion[];
  onMarkMe?: (name: string) => void;
  cardClassName: string;
  // Turns on the thumbs up / down under each answer.
  meetingId?: string;
  // Starts "Just answered" minimized to its header (click to open), so a
  // small window like focus mode keeps room for the current answer.
  minimizeRecent?: boolean;
}) {
  const [recentOpen, setRecentOpen] = useState(false);
  const earlier = answered.filter((q) => q.askedAt !== current?.askedAt).reverse();
  if (!current && !earlier.length) return null;
  // The last couple of answers stay open under the current one, so a new
  // question never takes an answer away before it's been read out.
  const recent = earlier.slice(0, RECENT_ANSWERS_SHOWN);
  const older = earlier.slice(RECENT_ANSWERS_SHOWN);
  return (
    <div className="space-y-2">
      {current && (
        <LiveQuestionCard
          question={current}
          className={cardClassName}
          onMarkMe={onMarkMe}
          meetingId={meetingId}
          feedback={answered.find((q) => q.askedAt === current.askedAt)?.feedback}
        />
      )}
      {recent.length > 0 && minimizeRecent && (
        <details
          open={recentOpen}
          onToggle={(e) => setRecentOpen(e.currentTarget.open)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2"
        >
          <summary className="cursor-pointer text-[11px] font-semibold tracking-[0.15em] text-slate-500">
            JUST ANSWERED ({recent.length})
          </summary>
          <ul className="mt-2 space-y-3">
            {recent.map((q) => (
              <EarlierAnswer key={q.askedAt} q={q} onMarkMe={onMarkMe} meetingId={meetingId} />
            ))}
          </ul>
        </details>
      )}
      {recent.length > 0 && !minimizeRecent && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-slate-500">JUST ANSWERED</p>
          <ul className="mt-2 space-y-3">
            {recent.map((q) => (
              <EarlierAnswer key={q.askedAt} q={q} onMarkMe={onMarkMe} meetingId={meetingId} />
            ))}
          </ul>
        </div>
      )}
      {older.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold tracking-[0.15em] text-slate-500">
            EARLIER QUESTIONS ({older.length})
          </summary>
          <ul className="mt-2 max-h-72 space-y-3 overflow-y-auto">
            {older.map((q) => (
              <EarlierAnswer key={q.askedAt} q={q} onMarkMe={onMarkMe} meetingId={meetingId} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const RECENT_ANSWERS_SHOWN = 2;

function EarlierAnswer({
  q,
  onMarkMe,
  meetingId,
}: {
  q: AnsweredQuestion;
  onMarkMe?: (name: string) => void;
  meetingId?: string;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <p className="flex items-baseline gap-1.5 text-xs italic text-slate-500">
          {q.caution && (
            <span
              title={q.caution.reason || CAUTION_STYLE[q.caution.level].label}
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${q.caution.level === "red" ? "bg-red-500" : "bg-amber-400"}`}
            />
          )}
          &ldquo;{q.question}&rdquo;
        </p>
        <AskedBy name={q.askedBy} onMarkMe={onMarkMe} />
      </div>
      <p className="mt-0.5 text-sm text-slate-800">{q.answer}</p>
      <QuestionLinks links={q.links} />
      {meetingId && <AnswerFeedback meetingId={meetingId} askedAt={q.askedAt} initial={q.feedback} />}
    </li>
  );
}

// What the person on the call mustn't agree to or bring up on their own,
// always on screen so it's there before anyone asks. Turned into short
// items by live coaching from the deal's decision boundaries; until then
// (or if it found none) the deal owner's own words show as-is. Items the
// other side has already asked about turn solid red.
export function OffLimitsBox({
  offLimits,
  decisionBoundaries,
}: {
  offLimits?: { label: string; raised: boolean }[];
  decisionBoundaries: string | null;
}) {
  const items = offLimits ?? [];
  if (!items.length && !decisionBoundaries) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2.5">
      <p className="mb-1.5 text-[11px] font-semibold tracking-[0.15em] text-red-700">DON&apos;T AGREE TO ON YOUR OWN</p>
      {items.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((c) => (
            <li
              key={c.label}
              className={
                c.raised
                  ? "rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white"
                  : "rounded-full border border-red-200 bg-white px-2 py-0.5 text-xs text-red-800"
              }
              title={c.raised ? "They've asked about this — don't commit, say you'll follow up" : undefined}
            >
              {c.raised ? "⚠ " : ""}
              {c.label}
              {c.raised ? " · they asked" : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-red-900">
          <span className="font-medium">From the deal owner: </span>
          {decisionBoundaries}
        </p>
      )}
    </div>
  );
}

// A few lines on where the call stands, so whoever's on it (or just
// joined it) doesn't have to read the transcript.
// What the other side has answered so far on this call (budget, timeline,
// who decides…), newest first: what's been learned, not a recap of what
// the person on the call just heard. Calls from before this show their
// old "so far" lines instead.
export function CallAnswers({
  answers,
  summary,
}: {
  answers?: { topic: string; answer: string }[];
  summary?: string[];
}) {
  if (answers?.length) {
    return (
      <div>
        <p className="mb-1 text-[11px] font-semibold tracking-[0.15em] text-emerald-700">THEY TOLD YOU</p>
        <ul className="flex flex-col gap-1">
          {answers.map((a, i) => (
            <li key={`${a.topic}-${i}`} className="text-sm text-slate-700">
              <span className="font-medium text-slate-900">{a.topic}:</span> {a.answer}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (!summary?.length) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold tracking-[0.15em] text-slate-500">SO FAR</p>
      <ul className="flex flex-col gap-0.5">
        {summary.map((line, i) => (
          <li key={i} className="flex gap-1.5 text-sm text-slate-700">
            <span className="text-slate-300">•</span>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CoachingLists({
  suggestions,
  coachingError,
  coachingRefreshing,
}: {
  suggestions: LiveSuggestions;
  coachingError: string | null;
  coachingRefreshing: boolean;
}) {
  const checklist = suggestions?.checklist ?? [];
  const open = checklist.filter((c) => !c.covered);
  const done = checklist.filter((c) => c.covered);
  return (
    <>
      {checklist.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.15em] text-accent">
            TO COVER{" "}
            <span className="font-normal tracking-normal text-slate-400">
              {done.length}/{checklist.length} done
            </span>
          </p>
          <ul className="flex flex-col gap-1">
            {open.map((c) => (
              <li key={c.label} className="flex items-start gap-2 rounded-md border-l-4 border-amber-400 bg-amber-50 px-2 py-1 text-sm text-slate-800">
                {c.label}
              </li>
            ))}
            {done.map((c) => (
              <li key={c.label} className="flex items-start gap-2 px-2 py-0.5 text-sm text-emerald-700">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px]">✓</span>
                <span className="text-slate-400 line-through">{c.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[11px] font-semibold tracking-[0.15em] text-accent">
          SUGGESTIONS
          <UpdatingBadge active={coachingRefreshing && Boolean(suggestions)} />
        </p>
        {!suggestions ? (
          <p className={`text-sm ${coachingError ? "text-amber-600" : "text-slate-500"}`}>
            {coachingError || "Preparing suggestions…"}
          </p>
        ) : suggestions.nudges.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing to go on yet — this fills in as the call goes.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {suggestions.nudges.map((n, i) => (
              <li key={i} className="flex gap-1.5 text-sm text-slate-800">
                <span className="text-accent">→</span>
                {n}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// Shows Anchor is listening. The transcript itself isn't shown during the
// call (answers and coaching are what to look at); the full one is on the
// meeting page once the call ends.
export function ListeningStrip({ heardLines, live, error }: { heardLines: number; live: boolean; error?: string | null }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <p className="flex items-center gap-2 text-[11px] text-slate-400">
        {live && <ListeningDots />}
        {heardLines === 0 ? "Listening. Waiting for people to speak…" : "Listening. The full transcript is ready after the call."}
      </p>
      {error && <p className="mt-1 text-xs text-amber-600">{error}</p>}
    </div>
  );
}

function ListeningDots() {
  return (
    <span className="flex items-end gap-0.5" title="Listening">
      <span className="h-1.5 w-0.5 animate-pulse rounded bg-emerald-400" />
      <span className="h-2.5 w-0.5 animate-pulse rounded bg-emerald-400 [animation-delay:150ms]" />
      <span className="h-2 w-0.5 animate-pulse rounded bg-emerald-400 [animation-delay:300ms]" />
    </span>
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
