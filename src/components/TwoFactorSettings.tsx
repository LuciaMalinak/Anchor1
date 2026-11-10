"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Status = { enabled: boolean; recoveryCodesLeft: number; teamRequires: boolean; isOwner: boolean };

// Two-step verification box: on Profile, and on /welcome/two-factor when
// the team requires it. Talks to /api/auth/two-factor.
export function TwoFactorSettings({ required = false }: { required?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [askCodeFor, setAskCodeFor] = useState<"disable" | "recovery-codes" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/two-factor")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => live && s && setStatus(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/two-factor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong — try again.");
        return null;
      }
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const data = await call({ action: "start" });
    if (data) {
      setSetup(data);
      setCode("");
    }
  }

  async function enable() {
    const data = await call({ action: "enable", code });
    if (data) {
      setStatus(data);
      setRecovery(data.recoveryCodes);
      setSetup(null);
      setCode("");
    }
  }

  async function confirmWithCode() {
    if (!askCodeFor) return;
    const data = await call({ action: askCodeFor, code });
    if (data) {
      setStatus(data);
      if (data.recoveryCodes) setRecovery(data.recoveryCodes);
      setAskCodeFor(null);
      setCode("");
    }
  }

  async function setRequired(on: boolean) {
    const data = await call({ action: "require", on });
    if (data) setStatus(data);
  }

  const codeInput = (
    <input
      value={code}
      onChange={(e) => setCode(e.target.value)}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="6-digit code"
      className="w-36 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10"
    />
  );

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      {!required && (
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Two-step verification</h2>
          <p className="text-sm text-slate-500">
            After your password or sign-in link, Anchor.AI also asks for a code from an
            authenticator app on your phone, so a stolen password alone can&apos;t get into your
            clients&apos; data.
          </p>
        </div>
      )}

      {!status ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : recovery ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-emerald-700">Two-step verification is on.</p>
          <p className="text-sm text-slate-600">
            Save these recovery codes somewhere safe, such as a password manager. Each one works once
            if you lose your phone. They won&apos;t be shown again.
          </p>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-50 p-3 font-mono text-sm text-slate-800">
            {recovery.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(recovery.join("\n")).catch(() => {})}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-brand hover:bg-slate-50"
            >
              Copy codes
            </button>
            <button
              type="button"
              onClick={() => {
                setRecovery(null);
                if (required) router.push("/dashboard");
              }}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              {required ? "I've saved them — continue" : "Done"}
            </button>
          </div>
        </div>
      ) : setup ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">
            1. In your authenticator app, add an account and scan this code. (Can&apos;t scan? Enter
            the key below instead.)
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg border border-slate-200" />
          <code className="break-all rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">{setup.secret}</code>
          <p className="text-sm text-slate-600">2. Enter the 6-digit code the app shows:</p>
          <div className="flex items-center gap-2">
            {codeInput}
            <button
              type="button"
              disabled={busy || code.trim().length < 6}
              onClick={enable}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
            >
              Turn on
            </button>
          </div>
        </div>
      ) : status.enabled ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-emerald-700">
            On. {status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? "" : "s"} left.
          </p>
          {askCodeFor ? (
            <div className="flex flex-wrap items-center gap-2">
              {codeInput}
              <button
                type="button"
                disabled={busy || !code.trim()}
                onClick={confirmWithCode}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
              >
                {askCodeFor === "disable" ? "Turn off" : "Get new codes"}
              </button>
              <button type="button" onClick={() => setAskCodeFor(null)} className="text-sm text-slate-500 hover:underline">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAskCodeFor("recovery-codes")}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-brand hover:bg-slate-50"
              >
                New recovery codes
              </button>
              {!status.teamRequires && (
                <button
                  type="button"
                  onClick={() => setAskCodeFor("disable")}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Turn off
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={start}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
          >
            Set up two-step verification
          </button>
        </div>
      )}

      {status?.isOwner && !required && !recovery && !setup && (
        <label className="flex items-start gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={status.teamRequires}
            disabled={busy}
            onChange={(e) => setRequired(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="font-medium text-slate-800">Require it for everyone on my team.</span>{" "}
            Teammates who haven&apos;t set it up are asked to before they can use Anchor.AI.
          </span>
        </label>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
