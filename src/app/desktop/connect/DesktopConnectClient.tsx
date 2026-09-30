"use client";

import { useEffect, useRef, useState } from "react";

// Creates a desktop token (same endpoint as the Integrations page's
// "Connect Anchor Desktop" button) and opens anchor-desktop://connect with
// it, which the installed app handles (handleDeepLink in
// desktop/src/main.ts). Runs once automatically when the app started this
// sign-in (state present); otherwise waits for a click.
export function DesktopConnectClient({
  state,
  device,
  email,
}: {
  state: string | null;
  device: string | null;
  email: string;
}) {
  const [status, setStatus] = useState<"idle" | "connecting" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const started = useRef(false);

  async function connect() {
    setStatus("connecting");
    setError(null);
    try {
      const res = await fetch("/api/profile/desktop-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: device ? `Anchor Desktop on ${device}` : "Anchor Desktop" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't connect the desktop app");
      const params = new URLSearchParams({ token: body.token, apiBase: window.location.origin });
      if (state) params.set("state", state);
      const link = `anchor-desktop://connect?${params}`;
      setDeepLink(link);
      setStatus("sent");
      window.location.assign(link);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect the desktop app");
      setStatus("error");
    }
  }

  useEffect(() => {
    // Guarded so React's development double-run can't create two tokens.
    if (!state || started.current) return;
    started.current = true;
    void connect();
    // connect only needs to run once, on arrival from the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "sent") {
    return (
      <div className="flex flex-col items-center gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">You&rsquo;re connected</h1>
          <p className="mt-1 text-sm text-slate-500">
            Anchor Desktop is now signed in as <span className="font-medium text-slate-700">{email}</span>. You can
            close this tab and go back to the app.
          </p>
        </div>
        <p className="text-xs text-slate-400">
          If your browser asked whether to open Anchor Desktop, click <strong>Open</strong>. Didn&rsquo;t switch
          over?{" "}
          <a href={deepLink ?? "#"} className="font-medium text-brand hover:underline">
            Open Anchor Desktop
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Connect Anchor Desktop</h1>
        <p className="mt-1 text-sm text-slate-500">
          Signed in as <span className="font-medium text-slate-700">{email}</span>. The desktop app will record
          your calls into this account.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={connect}
        disabled={status === "connecting"}
        className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
      >
        {status === "connecting" ? "Connecting…" : "Connect Anchor Desktop"}
      </button>
      <a href="/dashboard" className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
        Not you? Go to your dashboard to sign out first
      </a>
    </div>
  );
}
