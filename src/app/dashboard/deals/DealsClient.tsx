"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { STAGE_BADGE_CLASSES, DEFAULT_STAGE_BADGE_CLASSES } from "@/lib/dealStages";
import { HEALTH_LABEL, HEALTH_DOT_CLASSES, type DealHealth } from "@/lib/dealHealth";

type Deal = { id: string; name: string; stage: string; meetingCount: number; health: DealHealth };

export function DealsClient({ initialDeals }: { initialDeals: Deal[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't create the deal");
      setName("");
      router.push(`/dashboard/deals/${body.deal.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the deal");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-brand">Deals</h1>
        <p className="text-sm text-slate-500">
          Group meetings by client or account — prep, live status, and recaps in one place.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 border-l-4 border-l-accent bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-900">New deal</h2>
        <form onSubmit={handleCreate} className="mt-3 flex flex-col gap-3 sm:flex-row sm:max-w-xl">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Renewal"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={creating}
            className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create deal"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-slate-900">Your deals</h2>
        {initialDeals.length === 0 ? (
          <p className="text-sm text-slate-500">No deals yet — create one above.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {initialDeals.map((d) => (
              <Link
                key={d.id}
                href={`/dashboard/deals/${d.id}`}
                className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${HEALTH_DOT_CLASSES[d.health]}`}
                    title={HEALTH_LABEL[d.health]}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium text-slate-900">{d.name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      STAGE_BADGE_CLASSES[d.stage] || DEFAULT_STAGE_BADGE_CLASSES
                    }`}
                  >
                    {d.stage}
                  </span>
                  {(d.health === "needs-attention" || d.health === "stalled") && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        d.health === "stalled"
                          ? "bg-rose-50 text-rose-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {HEALTH_LABEL[d.health]}
                    </span>
                  )}
                  <span className="text-xs text-slate-500">
                    {d.meetingCount} meeting{d.meetingCount === 1 ? "" : "s"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
