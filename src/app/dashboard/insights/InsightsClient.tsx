"use client";

import { useState } from "react";

type Insights = {
  patterns: string[];
  atRisk: { dealName: string; reason: string }[];
  commonThemes: string[];
};

function SectionIcon({ path, className }: { path: string; className: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={path} />
    </svg>
  );
}

export function InsightsClient({
  initialInsights,
  initialDealCount,
}: {
  initialInsights: Insights | null;
  initialDealCount: number;
}) {
  const [insights, setInsights] = useState<Insights | null>(initialInsights);
  const [dealCount, setDealCount] = useState(initialDealCount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    initialInsights === null ? "Couldn't load insights — try refreshing." : null
  );

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't load insights");
      setInsights(body.insights);
      setDealCount(body.dealCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load insights");
    } finally {
      setLoading(false);
    }
  }

  const hasAnything =
    insights && (insights.patterns.length > 0 || insights.atRisk.length > 0 || insights.commonThemes.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand">Insights</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            Anchor reads every deal&apos;s rolling memory and latest meeting, then looks across
            your whole pipeline — {dealCount} deal{dealCount === 1 ? "" : "s"} — for what&apos;s
            worth your attention: deals going quiet, recurring objections, shared themes.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {insights && !hasAnything && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <p className="text-sm text-slate-500">
            Not enough finished meetings yet for Anchor to spot patterns — this fills in as deals
            progress and meetings wrap up.
          </p>
        </div>
      )}

      {insights && insights.atRisk.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <SectionIcon
              path="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
              className="text-amber-600"
            />
            Worth a second look
          </h2>
          <div className="mt-3 flex flex-col gap-2">
            {insights.atRisk.map((d, i) => (
              <div key={i} className="rounded-lg bg-white px-4 py-3 shadow-sm">
                <p className="text-sm font-medium text-slate-900">{d.dealName}</p>
                {d.reason && <p className="mt-0.5 text-sm text-slate-600">{d.reason}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {insights && insights.patterns.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <SectionIcon
              path="M12 2 9.5 8.5 2 9.5l5.5 5L6 22l6-4 6 4-1.5-7.5 5.5-5-7.5-1L12 2Z"
              className="text-accent"
            />
            Patterns across your pipeline
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
            {insights.patterns.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {insights && insights.commonThemes.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <SectionIcon
              path="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L4 3a1 1 0 0 0-1 1l.24 5.59a2 2 0 0 0 .59 1.41l9.58 9.59a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.83ZM7 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
              className="text-brand"
            />
            Common themes
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {insights.commonThemes.map((t, i) => (
              <span
                key={i}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
              >
                {t}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
