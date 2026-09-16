"use client";

import { useState } from "react";

type Insights = {
  patterns: string[];
  atRisk: { dealName: string; reason: string }[];
  commonThemes: string[];
};

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Insights</h1>
          <p className="text-sm text-slate-500">
            What Anchor notices across your whole pipeline — {dealCount} deal{dealCount === 1 ? "" : "s"}.
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
        <p className="text-sm text-slate-500">
          Not enough finished meetings yet for Anchor to spot patterns — this fills in as deals
          progress and meetings wrap up.
        </p>
      )}

      {insights && insights.atRisk.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-sm font-medium text-amber-900">Worth a second look</h2>
          <div className="mt-3 flex flex-col gap-2">
            {insights.atRisk.map((d, i) => (
              <div key={i} className="rounded-lg bg-white px-4 py-3">
                <p className="text-sm font-medium text-slate-900">{d.dealName}</p>
                {d.reason && <p className="mt-0.5 text-sm text-slate-600">{d.reason}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {insights && insights.patterns.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-medium text-slate-900">Patterns across your pipeline</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
            {insights.patterns.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {insights && insights.commonThemes.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-medium text-slate-900">Common themes</h2>
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
