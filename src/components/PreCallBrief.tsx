"use client";

import { useEffect, useState } from "react";
import { useAskAnchor } from "@/components/AskAnchorDock";

type Brief = {
  summary: string;
  people: { name: string; note: string }[];
  openItems: string[];
  questions: string[];
  watchOut: string[];
};

const STORAGE_PREFIX = "anchor.brief.";

// The pre-call brief on a deal's Before tab: where things stand, who
// matters, what's still open, what to ask and what to watch out for.
// Written on request from the deal's meetings, emails and notes, and kept
// for this browser session so switching tabs doesn't lose it.
export function PreCallBrief({ dealId, dealName }: { dealId: string; dealName: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask } = useAskAnchor();

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_PREFIX + dealId);
      if (!raw) return;
      const saved = JSON.parse(raw) as { brief: Brief; generatedAt: string };
      queueMicrotask(() => {
        setBrief(saved.brief);
        setGeneratedAt(saved.generatedAt);
      });
    } catch {
      // Nothing saved, or storage blocked: show the button.
    }
  }, [dealId]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/brief`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't write the brief");
      setBrief(body.brief);
      setGeneratedAt(body.generatedAt);
      try {
        sessionStorage.setItem(STORAGE_PREFIX + dealId, JSON.stringify({ brief: body.brief, generatedAt: body.generatedAt }));
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't write the brief");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-brand">Pre-call brief</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {generatedAt
              ? `Written ${new Date(generatedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} from this deal's calls, emails and notes`
              : "Who matters, what's still open, and what to ask, from this deal's calls, emails and notes"}
          </p>
        </div>
        <div className="flex gap-2">
          {brief && (
            <button
              type="button"
              onClick={() => ask(`Turn this into a short agenda for my next call with ${dealName}.`)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand hover:text-brand"
            >
              Make an agenda
            </button>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-dark disabled:opacity-50"
          >
            {loading ? "Writing…" : brief ? "Refresh" : "Prep me for the next call"}
          </button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {brief && (
        <div className="mt-4 flex flex-col gap-4 text-sm text-slate-700">
          <p className="text-[15px] leading-relaxed text-slate-800">{brief.summary}</p>
          <div className="grid gap-4 md:grid-cols-2">
            {brief.people.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">People</h3>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {brief.people.map((p) => (
                    <li key={p.name}>
                      <span className="font-medium text-slate-900">{p.name}</span> — {p.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {brief.openItems.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Still open</h3>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {brief.openItems.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {brief.questions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ask</h3>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {brief.questions.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {brief.watchOut.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700">Watch out for</h3>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {brief.watchOut.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
