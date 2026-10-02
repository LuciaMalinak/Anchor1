"use client";

import { useCallback, useEffect, useState } from "react";

// "Get help" in the header: describe the problem, then (optionally) let
// Anchor support see and control your screen through Google's Chrome
// Remote Desktop — you generate a one-time code, support enters it, and
// Chrome asks you to approve before anything is shared. You can stop at
// any time. See src/lib/support.ts and AdminSupportRequests.tsx.

const REMOTE_SUPPORT_URL = "https://remotedesktop.google.com/support";
const ACCESS_CODE_TTL_MS = 5 * 60 * 1000;
const POLL_MS = 10_000;

type SupportRequest = {
  id: string;
  message: string;
  accessCode: string | null;
  accessCodeAt: string | null;
  status: "open" | "in_progress" | "resolved";
};

export function SupportButton() {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<SupportRequest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const res = await fetch("/api/support").catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    if (body) setRequest(body.request);
    setLoaded(true);
  }, []);

  // While the window is open: keep the request's status current (so it
  // shows when support connects) and tick the code's countdown.
  useEffect(() => {
    if (!open) return;
    // Loader defined in here (as in useLiveMeeting.ts) so the first load
    // doesn't set state synchronously inside the effect.
    async function load() {
      await refresh();
    }
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [open, refresh]);

  async function send(url: string, method: "POST" | "PATCH", payload: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body.error || "Something went wrong — try again.");
      setRequest(body.request.status === "resolved" ? null : body.request);
      return true;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong — try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  const codeAge = request?.accessCodeAt
    ? now - new Date(request.accessCodeAt).getTime()
    : null;
  const codeFresh = codeAge !== null && codeAge < ACCESS_CODE_TTL_MS;
  const secondsLeft =
    codeAge !== null
      ? Math.max(0, Math.ceil((ACCESS_CODE_TTL_MS - codeAge) / 1000))
      : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full px-3 py-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
      >
        Get help
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-16 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-title"
            className="w-full max-w-lg rounded-2xl bg-white p-6 text-slate-800 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="support-title"
                  className="text-lg font-semibold text-slate-900"
                >
                  Get help
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Tell us what&apos;s wrong. If it helps, you can let us see
                  your screen and click around for you — only when you approve
                  it, and you can stop any time.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {!loaded ? (
              <p className="mt-6 text-sm text-slate-400">Loading…</p>
            ) : !request ? (
              <form
                className="mt-5 flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await send("/api/support", "POST", {
                      message,
                      pageUrl: window.location.href,
                    })
                  )
                    setMessage("");
                }}
              >
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  required
                  placeholder="What's going wrong, or what do you need help with?"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <button
                  type="submit"
                  disabled={busy || !message.trim()}
                  className="self-end rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Send to support"}
                </button>
              </form>
            ) : (
              <div className="mt-5 flex flex-col gap-4">
                <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
                  <p className="text-xs font-medium text-slate-500">
                    Your request
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">
                    {request.message}
                  </p>
                  <p className="mt-2 text-xs font-medium text-emerald-700">
                    {request.status === "in_progress"
                      ? "● Support is working on this now"
                      : "✓ Sent — we'll get back to you"}
                  </p>
                </div>

                {request.status === "in_progress" && codeFresh ? (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    Support is connecting. When Chrome asks whether to share
                    your screen, click <strong>Share</strong>. To end it at any
                    time, click <strong>Stop Sharing</strong>.
                  </p>
                ) : null}

                <div className="flex flex-col gap-3 rounded-lg border border-slate-200 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-900">
                    Let support see your screen (optional)
                  </p>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
                    <li>
                      Open{" "}
                      <a
                        href={REMOTE_SUPPORT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-brand underline"
                      >
                        Chrome Remote Desktop
                      </a>{" "}
                      in Google Chrome.
                    </li>
                    <li>
                      Under <strong>Get Support</strong>, click{" "}
                      <strong>Generate Code</strong>. The first time, it asks
                      you to install a small helper; that&apos;s a one-time
                      step.
                    </li>
                    <li>
                      Paste the 12-digit code below. It works for 5 minutes.
                    </li>
                  </ol>
                  {codeFresh ? (
                    <p className="text-sm text-slate-600">
                      Code sent ·{" "}
                      <span className="font-medium tabular-nums text-slate-900">
                        {Math.floor(secondsLeft / 60)}:
                        {String(secondsLeft % 60).padStart(2, "0")}
                      </span>{" "}
                      left. Keep the Chrome Remote Desktop tab open — Chrome
                      will ask you to approve before anything is shared.
                    </p>
                  ) : (
                    <form
                      className="flex gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (
                          await send(`/api/support/${request.id}`, "PATCH", {
                            accessCode: code,
                          })
                        )
                          setCode("");
                      }}
                    >
                      <input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        inputMode="numeric"
                        placeholder={
                          request.accessCode
                            ? "Code expired — paste a new one"
                            : "1234 5678 9012"
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tracking-wider outline-none focus:border-brand"
                      />
                      <button
                        type="submit"
                        disabled={busy || code.replace(/\D/g, "").length !== 12}
                        className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                      >
                        Share code
                      </button>
                    </form>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void send(`/api/support/${request.id}`, "PATCH", {
                      status: "resolved",
                    })
                  }
                  disabled={busy}
                  className="self-start text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  All sorted — close this request
                </button>
              </div>
            )}
            {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
