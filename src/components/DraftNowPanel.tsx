"use client";

import { useEffect, useRef, useState } from "react";
import type { DraftReport } from "@/lib/morningBrief";

// "Draft my replies now" (in the Morning brief settings): runs Gmail
// drafting straight away and shows what happened — the Google account
// the drafts go to, every email drafted, every one skipped and why, and
// any error from Gmail. `embedded`: inside another card, so no card of
// its own.
// On the brief page: `token` (no sign-in needed) and `autoRun` when opened
// from "Save all replies to Gmail drafts" in the brief email.
export function DraftNowPanel({
  embedded,
  token,
  autoRun,
  buttonLabel = "Draft my replies now",
  intro = "Anchor drafts a reply to each email waiting on you and leaves it in Gmail, ready to send. It also does this on its own through the day.",
}: {
  embedded?: boolean;
  token?: string;
  autoRun?: boolean;
  buttonLabel?: string;
  intro?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DraftReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setReport(null);
    const res = await fetch("/api/morning-brief/draft-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(token ? { token } : {}),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) setError(body.error || "Couldn't reach Anchor. Try again.");
    else setReport(body as DraftReport);
  }

  const started = useRef(false);
  useEffect(() => {
    if (autoRun && !started.current) {
      started.current = true;
      void run();
    }
    // Only on first load from the email link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftsUrl = report?.account
    ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(report.account)}#drafts`
    : "https://mail.google.com/mail/#drafts";

  return (
    <section className={embedded ? "" : "rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-brand">Gmail reply drafts</h3>
          <p className="mt-1 text-sm text-slate-500">{intro}</p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? "Drafting… (up to a minute)" : buttonLabel}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {report && (
        <div className="mt-4 space-y-3 text-sm">
          <p className="text-slate-600">
            Google account: <strong>{report.account ?? "not connected"}</strong>
            {report.account && (
              <>
                {" · "}
                <a href={draftsUrl} target="_blank" rel="noreferrer" className="font-medium text-brand underline">
                  Open its Drafts
                </a>
              </>
            )}
          </p>
          {report.blocked ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
              {report.blocked}{" "}
              {!report.canDraft && report.account && (
                <a
                  href="/api/integrations/google/connect?add=gmail_compose&returnTo=%2Fdashboard%2Fprofile%23morning-brief"
                  className="font-semibold underline"
                >
                  Allow Gmail drafts
                </a>
              )}
            </p>
          ) : (
            <>
              <p className="text-slate-700">
                {report.waiting} email{report.waiting === 1 ? "" : "s"} waiting on you · <strong>{report.drafted.length} drafted now</strong>
                {report.alreadyInDrafts.length ? ` · ${report.alreadyInDrafts.length} already in Drafts` : ""}
              </p>
              <List title="Drafted now" items={report.drafted.map((d) => `${d.fromName} — ${d.subject}`)} tone="text-emerald-700" />
              <List title="Already in your Drafts" items={report.alreadyInDrafts.map((d) => `${d.fromName} — ${d.subject}`)} tone="text-slate-600" />
              <List title="Skipped" items={report.skipped.map((d) => `${d.fromName} — ${d.subject}: ${d.reason}`)} tone="text-slate-500" />
              {report.waiting === 0 && (
                <p className="text-slate-500">
                  Anchor didn&apos;t find emails waiting on you in the last 2 weeks of {report.account}&apos;s inbox (it leaves out
                  newsletters, notifications, Promotions/Updates and threads you&apos;ve already answered).
                </p>
              )}
            </>
          )}
          {report.problems.map((p) => (
            <p key={p} className="text-red-600">
              {p}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      <ul className={`mt-1 list-disc space-y-0.5 pl-5 ${tone}`}>
        {items.map((i, n) => (
          <li key={n}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
