"use client";

import { useEffect, useState } from "react";

type TokenRow = {
  id: string;
  label: string;
  lastUsedAt: string | null;
  createdAt: string;
};

// Lets the user mint a bearer token for Anchor's desktop app (see
// src/lib/apiToken.ts and desktop/ at the repo root) — the Granola-style
// "no bot joins the call" recorder, which authenticates with one of
// these instead of a browser session. Shown on the Integrations page.
export function DesktopTokenPanel() {
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/profile/desktop-token");
      const body = await res.json();
      setTokens(body.tokens ?? []);
    } catch {
      setError("Couldn't load your desktop tokens.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile/desktop-token")
      .then((res) => (res.ok ? res.json() : { tokens: [] }))
      .then((body) => {
        if (cancelled) return;
        setTokens(Array.isArray(body.tokens) ? body.tokens : []);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your desktop tokens.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    setFreshToken(null);
    try {
      const label = window.prompt("Name this token (e.g. \"Work laptop\")", "Desktop app") || "Desktop app";
      const res = await fetch("/api/profile/desktop-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't create a token");
      setFreshToken(body.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create a token");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string, label: string) {
    if (!window.confirm(`Revoke "${label}"? The desktop app using it will stop being able to record.`)) return;
    setRevoking(id);
    setError(null);
    try {
      const res = await fetch(`/api/profile/desktop-token?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't revoke that token");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't revoke that token");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <p className="text-sm font-medium text-slate-900">Anchor Desktop</p>
        <p className="mt-1 text-xs text-slate-500">
          Records Zoom, Teams, and Meet calls straight from your computer — no bot joins the call. Generate a
          token below and paste it into the desktop app when you install it.
        </p>
      </div>

      {freshToken && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium">Copy this now — Anchor won&apos;t show it again:</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-[11px] text-slate-800">
            {freshToken}
          </code>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {tokens && tokens.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-xs text-slate-600">
              <span>
                {t.label}
                {t.lastUsedAt ? ` · last used ${new Date(t.lastUsedAt).toLocaleDateString()}` : " · never used"}
              </span>
              <button
                type="button"
                onClick={() => handleRevoke(t.id, t.label)}
                disabled={revoking === t.id}
                className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                {revoking === t.id ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={handleCreate}
        disabled={creating}
        className="mt-1 self-start rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50"
      >
        {creating ? "Generating…" : "Generate desktop token"}
      </button>
    </div>
  );
}
