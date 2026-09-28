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
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
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

  // The "one click" path: mints a token the exact same way the manual
  // flow below always has, then hands it straight to the desktop app via
  // the anchor-desktop:// link it registers itself to handle (see
  // handleDeepLink in desktop/src/main.ts) — so nothing needs copying or
  // pasting. If the app isn't installed yet, the browser will show its
  // own "no app can open this" message; that's expected for a
  // first-time member and the Download button above gets them the app,
  // after which this same button works.
  async function handleConnect() {
    setConnecting(true);
    setError(null);
    setConnected(false);
    try {
      const res = await fetch("/api/profile/desktop-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Desktop app" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't create a token");
      const apiBase = window.location.origin;
      window.location.href = `anchor-desktop://connect?token=${encodeURIComponent(body.token)}&apiBase=${encodeURIComponent(apiBase)}`;
      setConnected(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect the desktop app");
    } finally {
      setConnecting(false);
    }
  }

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
          Records Zoom, Teams, and Meet calls straight from your computer — no bot joins the call.
        </p>
      </div>

      <ol className="flex flex-col gap-2 text-xs text-slate-600">
        <li className="flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-medium text-slate-500">
            1
          </span>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- this isn't an app page,
              it's a real file download (the route 302s straight to a signed R2 URL), which needs
              an actual browser navigation rather than Next's client-side router. */}
          <a
            href="/api/download/desktop-app/mac"
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-dark"
          >
            Download for Mac
          </a>
          <span className="text-[11px] text-slate-400">Open it once after installing.</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-medium text-slate-500">
            2
          </span>
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="rounded-lg border border-brand px-3 py-1.5 text-xs font-medium text-brand shadow-sm transition hover:bg-brand/5 disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect Anchor Desktop"}
          </button>
          <span className="text-[11px] text-slate-400">Signs the app into your account automatically.</span>
        </li>
      </ol>

      {connected && (
        <p className="text-xs text-emerald-700">
          Sent — check the Anchor Desktop app, it should already show &quot;Connected.&quot; If nothing happened,
          the app isn&apos;t installed yet (step 1 above) or isn&apos;t open — open it and try step 2 again.
        </p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {tokens && tokens.length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-slate-100 pt-3">
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

      <div className="border-t border-slate-100 pt-2">
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="text-[11px] font-medium text-slate-400 underline decoration-dotted hover:text-slate-600"
        >
          {showManual ? "Hide manual setup" : "Having trouble? Set up manually instead"}
        </button>
        {showManual && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-[11px] text-slate-500">
              If the automatic connect button doesn&apos;t work (for example on Windows, which isn&apos;t
              available yet), generate a token here and paste it into the app&apos;s &quot;Paste your desktop
              token&quot; box instead.
            </p>
            {freshToken && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-medium">Copy this now — Anchor won&apos;t show it again:</p>
                <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-[11px] text-slate-800">
                  {freshToken}
                </code>
              </div>
            )}
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="self-start rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              {creating ? "Generating…" : "Generate desktop token"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
