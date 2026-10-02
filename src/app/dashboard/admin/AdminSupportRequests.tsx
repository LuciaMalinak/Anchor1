"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// Support requests from "Get help" (SupportButton.tsx), for the app owner.
// Refreshes on its own every few seconds, since a screen-sharing code is
// only good for 5 minutes. To help: copy the code, open Chrome Remote
// Desktop → Give Support, paste it — the person then approves in Chrome.

const REMOTE_SUPPORT_URL = "https://remotedesktop.google.com/support";
const ACCESS_CODE_TTL_MS = 5 * 60 * 1000;
const POLL_MS = 8_000;

type Row = {
  id: string;
  message: string;
  pageUrl: string | null;
  accessCode: string | null;
  accessCodeAt: string | null;
  status: "open" | "in_progress" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  userName: string | null;
  userEmail: string;
  teamId: string | null;
  teamName: string | null;
};

function timeAgo(iso: string, now: number): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatCode(code: string) {
  return code.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
}

export function AdminSupportRequests() {
  const [active, setActive] = useState<Row[]>([]);
  const [resolved, setResolved] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/support").catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    if (body) {
      setActive(body.active);
      setResolved(body.resolved);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
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
  }, [refresh]);

  async function setStatus(id: string, status: Row["status"]) {
    await fetch(`/api/admin/support/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    void refresh();
  }

  async function connect(row: Row) {
    if (row.accessCode) {
      await navigator.clipboard.writeText(row.accessCode).catch(() => null);
      setCopied(row.id);
    }
    window.open(REMOTE_SUPPORT_URL, "_blank", "noopener,noreferrer");
    if (row.status === "open") void setStatus(row.id, "in_progress");
  }

  return (
    <section id="support" className="flex flex-col gap-4 scroll-mt-24">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-slate-900">
          Support requests
        </h2>
        {active.length > 0 && (
          <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700">
            {active.length} waiting
          </span>
        )}
      </div>

      {!loaded ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : active.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-400">
          No one needs help right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((r) => {
            const codeAge = r.accessCodeAt
              ? now - new Date(r.accessCodeAt).getTime()
              : null;
            const codeLive =
              r.accessCode && codeAge !== null && codeAge < ACCESS_CODE_TTL_MS;
            const left =
              codeAge !== null
                ? Math.max(0, Math.ceil((ACCESS_CODE_TTL_MS - codeAge) / 1000))
                : 0;
            return (
              <li
                key={r.id}
                className="rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {r.userName || r.userEmail}
                      {r.userName && (
                        <span className="font-normal text-slate-500">
                          {" "}
                          · {r.userEmail}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.teamId && r.teamName ? (
                        <Link
                          href={`/dashboard/admin/teams/${r.teamId}`}
                          className="hover:text-brand"
                        >
                          {r.teamName}
                        </Link>
                      ) : (
                        "No team"
                      )}{" "}
                      · asked {timeAgo(r.createdAt, now)}
                      {r.status === "in_progress" && (
                        <span className="font-medium text-emerald-700">
                          {" "}
                          · you&apos;re on it
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {r.status === "open" && (
                      <button
                        type="button"
                        onClick={() => void setStatus(r.id, "in_progress")}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        I&apos;m on it
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void setStatus(r.id, "resolved")}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Resolved
                    </button>
                  </div>
                </div>

                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                  {r.message}
                </p>
                {r.pageUrl && (
                  <p
                    className="mt-1 truncate text-xs text-slate-400"
                    title={r.pageUrl}
                  >
                    From: {r.pageUrl}
                  </p>
                )}

                <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
                  {codeLive ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-slate-500">
                          Screen-sharing code · {Math.floor(left / 60)}:
                          {String(left % 60).padStart(2, "0")} left
                        </p>
                        <p className="font-mono text-2xl font-semibold tracking-widest text-slate-900">
                          {formatCode(r.accessCode!)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void connect(r)}
                        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
                      >
                        {copied === r.id
                          ? "Copied — paste under Give Support"
                          : "Copy code & connect"}
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      {r.accessCode
                        ? "Their screen-sharing code expired. Ask them to generate a new one in Get help."
                        : "No screen-sharing code yet. They can add one from Get help if you need to see their screen."}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {resolved.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            {showResolved ? "Hide" : "Show"} recently resolved (
            {resolved.length})
          </button>
          {showResolved && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {resolved.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">
                      {r.userName || r.userEmail}
                    </span>
                    <span className="text-slate-500">
                      {" "}
                      · {r.message.slice(0, 120)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {r.resolvedAt ? timeAgo(r.resolvedAt, now) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
