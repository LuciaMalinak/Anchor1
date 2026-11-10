"use client";

import { useEffect, useState } from "react";

type Member = {
  id: string;
  name: string | null;
  email: string | null;
  isOwner: boolean;
  twoFactor: boolean;
  connections: string[];
  desktopApp: string | null;
  signedInSessions: number;
  lastSeen: string | null;
};

const PROVIDER_NAMES: Record<string, string> = {
  google: "Google",
  microsoft: "Microsoft",
  slack: "Slack",
  zoom: "Zoom",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  dropbox: "Dropbox",
};

function day(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
}

// Team owner only (the API refuses anyone else): who can get into the
// team's data and how, "sign out everywhere", and a full data download.
export function TeamSecurityPanel() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/team/security")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setMembers(d.members))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function signOut(m: Member) {
    if (!window.confirm(`Sign ${m.name || m.email} out of Anchor.AI everywhere (browsers and the desktop app)? Their data stays; they can sign in again if they still have access to their account.`)) return;
    setBusy(m.id);
    setNote(null);
    try {
      const res = await fetch("/api/team/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sign-out", userId: m.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't sign them out");
      setNote(`${m.name || m.email} is signed out everywhere.`);
      setMembers((list) => list?.map((x) => (x.id === m.id ? { ...x, signedInSessions: 0, desktopApp: null } : x)) ?? null);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't sign them out");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Security and your data</h2>
          <p className="text-sm text-slate-500">
            Only you, as team owner, see this. Require two-step verification for everyone from your
            Profile page.
          </p>
        </div>
        <a
          href="/api/team/export"
          className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-brand hover:bg-slate-50"
        >
          Download all our data
        </a>
      </div>

      {!members ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="py-2 pr-3 font-medium">Person</th>
                <th className="py-2 pr-3 font-medium">Two-step</th>
                <th className="py-2 pr-3 font-medium">Connected</th>
                <th className="py-2 pr-3 font-medium">Desktop app</th>
                <th className="py-2 pr-3 font-medium">Signed in</th>
                <th className="py-2 pr-3 font-medium">Last active</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-800">{m.name || m.email}</div>
                    {m.name && <div className="text-xs text-slate-500">{m.email}</div>}
                  </td>
                  <td className="py-2 pr-3">
                    {m.twoFactor ? <span className="text-emerald-700">On</span> : <span className="text-amber-700">Off</span>}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {m.connections.length ? m.connections.map((p) => PROVIDER_NAMES[p] ?? p).join(", ") : "—"}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {m.desktopApp ? (m.desktopApp === "never used" ? "Connected" : `Used ${day(m.desktopApp)}`) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {m.signedInSessions} device{m.signedInSessions === 1 ? "" : "s"}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{day(m.lastSeen)}</td>
                  <td className="py-2 text-right">
                    {!m.isOwner && (m.signedInSessions > 0 || m.desktopApp) && (
                      <button
                        type="button"
                        disabled={busy === m.id}
                        onClick={() => signOut(m)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Sign out everywhere
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{note}</p>}
    </section>
  );
}
