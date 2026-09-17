"use client";

import { useState } from "react";

export function JoinForm({ teamId }: { teamId: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dealName, setDealName] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !dealName.trim()) {
      setError("Fill in every field.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/join-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, name, email, dealName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't send your request");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your request");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
        Request sent — you&apos;ll get an email once someone on the team approves it.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
      <div>
        <label className="text-xs font-medium text-slate-600">Your name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          placeholder="Jamie Rivera"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-600">Your email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          placeholder="jamie@company.com"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-600">
          Which deal or client are you here for?
        </label>
        <input
          value={dealName}
          onChange={(e) => setDealName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          placeholder="e.g. Acme Co."
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={sending}
        className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-dark disabled:opacity-50"
      >
        {sending ? "Sending…" : "Request to join"}
      </button>
    </form>
  );
}
