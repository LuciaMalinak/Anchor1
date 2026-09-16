"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Member = { id: string; name: string | null; email: string };
type Invite = { id: string; email: string };

export function TeamClient({
  teamName,
  members,
  invites,
}: {
  teamName: string;
  members: Member[];
  invites: Invite[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't send the invite");
      setEmail("");
      setNotice(
        body.emailWarning
          ? `Added — but the invite email didn't send (${body.emailWarning}). They can still sign in with this email to join.`
          : "Invited — they'll join the team automatically the first time they sign in."
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the invite");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{teamName}</h1>
        <p className="text-sm text-slate-500">Everyone here shares deals, files, and recaps.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium text-slate-900">Invite a teammate</h2>
        <form onSubmit={handleInvite} className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={sending}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
          >
            {sending ? "Sending…" : "Invite"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {notice && <p className="mt-2 text-sm text-slate-600">{notice}</p>}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-slate-900">Members ({members.length})</h2>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <span className="text-sm font-medium text-slate-900">{m.name || m.email}</span>
              <span className="text-xs text-slate-500">{m.email}</span>
            </li>
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-slate-900">Pending invites</h2>
          <ul className="flex flex-col gap-2">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3"
              >
                <span className="text-sm text-slate-600">{i.email}</span>
                <span className="text-xs text-slate-400">Waiting to sign in</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
