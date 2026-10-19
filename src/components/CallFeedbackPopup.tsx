"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnswerFeedback } from "@/components/LiveCoachingBits";

type Pending = {
  id: string;
  title: string;
  questions: { askedAt: number; question: string; answer: string; feedback: "up" | "down" | null }[];
};

// Checked again this often while Anchor is open, so it shows up shortly
// after a call is written up.
const CHECK_EVERY_MS = 60_000;

// After each call where Anchor helped live: "How did Anchor do?" — a
// thumbs up / down for the call, the answers it gave (each can be rated
// or corrected, which teaches Anchor's playbook), and a note for next
// time. Skip (or the ✕) closes it for good for that call.
export function CallFeedbackPopup() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    let stopped = false;
    const check = () =>
      fetch("/api/meetings/call-feedback")
        .then((r) => (r.ok ? r.json() : { meeting: null }))
        .then((body) => {
          if (!stopped) setPending((cur) => cur ?? body.meeting ?? null);
        })
        .catch(() => {});
    void check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  async function finish(skipped: boolean) {
    if (!pending) return;
    setBusy(true);
    await fetch(`/api/meetings/${pending.id}/call-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(skipped ? { skipped: true } : { rating, note }),
    }).catch(() => {});
    setBusy(false);
    if (skipped) {
      setPending(null);
      return;
    }
    setThanks(true);
    setTimeout(() => {
      setThanks(false);
      setPending(null);
    }, 1800);
  }

  if (!pending) return null;
  const thumb = "rounded-lg border px-3 py-1.5 text-lg transition hover:bg-slate-50";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/20 p-4 sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">After your call</p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">How did Anchor do on &ldquo;{pending.title}&rdquo;?</h2>
          </div>
          <button type="button" onClick={() => finish(true)} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {thanks ? (
          <p className="px-5 py-8 text-center text-sm text-emerald-700">Thanks — Anchor will use this on your next calls.</p>
        ) : (
          <>
            <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRating("up")}
                  className={`${thumb} ${rating === "up" ? "border-emerald-300 bg-emerald-50" : "border-slate-200"}`}
                  title="Helpful"
                >
                  👍
                </button>
                <button
                  type="button"
                  onClick={() => setRating("down")}
                  className={`${thumb} ${rating === "down" ? "border-red-300 bg-red-50" : "border-slate-200"}`}
                  title="Not helpful"
                >
                  👎
                </button>
                <span className="text-sm text-slate-500">Were the suggestions and answers helpful?</span>
              </div>

              {pending.questions.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold tracking-[0.15em] text-slate-500">ANSWERS ANCHOR GAVE</p>
                  <ul className="flex flex-col gap-3">
                    {pending.questions.map((q) => (
                      <li key={q.askedAt} className="rounded-lg border border-slate-100 px-3 py-2">
                        <p className="text-xs italic text-slate-500">&ldquo;{q.question}&rdquo;</p>
                        <p className="mt-0.5 text-sm text-slate-800">{q.answer}</p>
                        <AnswerFeedback meetingId={pending.id} askedAt={q.askedAt} initial={q.feedback ?? undefined} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <label className="flex flex-col gap-1 text-sm text-slate-700">
                Anything Anchor should do differently next time? <span className="text-xs text-slate-400">(optional)</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="e.g. shorter answers, mention our onboarding offer, don't suggest discounts"
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
              <Link href="/dashboard/playbook" className="text-xs text-slate-400 hover:text-brand">
                See what Anchor has learned
              </Link>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => finish(true)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
                  Skip
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => finish(false)}
                  className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
