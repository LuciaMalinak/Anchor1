"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Deal = { id: string; name: string; meetingCount: number };

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
        <h1 className="text-xl font-semibold text-slate-900">Deals</h1>
        <p className="text-sm text-slate-500">
          Group meetings by client or account — prep, live status, and recaps in one place.
        </p>
      </div>

      <section className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-900">New deal</h2>
        <form onSubmit={handleCreate} className="mt-3 flex flex-col gap-3 sm:flex-row">
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
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
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
                className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
              >
                <span className="text-sm font-medium text-slate-900">{d.name}</span>
                <span className="text-xs text-slate-500">
                  {d.meetingCount} meeting{d.meetingCount === 1 ? "" : "s"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
