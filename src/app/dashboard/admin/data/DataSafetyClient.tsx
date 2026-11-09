"use client";

import { useCallback, useEffect, useState } from "react";

type Change = { id: string; action: string; actorEmail: string | null; teamId: string | null; targetId: string | null; details: Record<string, unknown> | null; createdAt: string };
type Person = {
  id: string;
  name: string | null;
  email: string;
  teamId: string | null;
  restrictedToDeals: boolean;
  createdAt: string;
  team: { id: string; name: string; isOwner: boolean; dealCount: number } | null;
  dealGrants: number;
  createdDeals: { id: string; name: string; stage: string | null; teamId: string; teamName: string | null; deleted: boolean; onOtherTeam: boolean }[];
  history: Change[];
};
type Data = {
  people: Person[];
  deleted: { id: string; name: string; stage: string | null; deletedAt: string | null; deletedBy: string | null; fromTeamId: string | null }[];
  recent: Change[];
  teams: { id: string; name: string; ownerEmail: string | null }[];
  backup: { configured: boolean; last: { ok: boolean; key: string | null; bytes: number | null; error: string | null; createdAt: string } | null };
};

const card = "rounded-xl border border-slate-200 bg-white p-5";
const btn = "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const input = "rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none";

const ACTIONS: Record<string, string> = {
  deal_deleted: "Deal deleted",
  deal_restored: "Deal restored",
  member_removed: "Removed from team",
  account_deleted: "Account deleted",
  team_deleted: "Team owner deleted account (data kept)",
  user_moved: "Moved to team",
  meeting_deleted: "Call deleted (copy kept)",
  file_deleted: "File deleted (copy kept)",
  message_deleted: "Message deleted (copy kept)",
  contact_deleted: "Contact deleted (copy kept)",
};

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

function label(c: Change) {
  const d = c.details ?? {};
  const what = (d.name as string) || (d.email as string) || (d.teamName as string) || "";
  return `${ACTIONS[c.action] ?? c.action}${what ? `: ${what}` : ""}${c.actorEmail ? ` · by ${c.actorEmail}` : ""}`;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const json = await res?.json().catch(() => null);
  return { ok: Boolean(res?.ok), error: (json?.error as string) ?? null };
}

export function DataSafetyClient() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (query: string) => {
    const res = await fetch(`/api/admin/data?q=${encodeURIComponent(query)}`).catch(() => null);
    if (res?.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    async function first() {
      await load("");
    }
    void first();
  }, [load]);

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    const r = await post(body);
    setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error ?? "That didn't work." });
    setBusy(false);
    await load(q);
  }

  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const b = data.backup;

  return (
    <div className="flex flex-col gap-8">
      {msg && <p className={`rounded-lg px-4 py-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

      <section className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Nightly backup</h2>
          <p className="mt-1 text-xs text-slate-600">
            {!b.configured
              ? "Not running: backups need file storage (the R2_* settings in Render)."
              : b.last
                ? b.last.ok
                  ? `Last backup ${when(b.last.createdAt)} · ${((b.last.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB · ${b.last.key}`
                  : `Last attempt failed ${when(b.last.createdAt)}: ${b.last.error}`
                : "No backup yet: the first runs within a day, or click Back up now."}
          </p>
        </div>
        <button disabled={busy || !b.configured} onClick={() => act({ action: "backupNow" }, "Backup saved.")} className={btn}>
          {busy ? "Working…" : "Back up now"}
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">Find a person</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(q);
          }}
          className="flex gap-2"
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email, e.g. jackie" className={`${input} flex-1`} />
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            Search
          </button>
        </form>
        {data.people.map((p) => (
          <PersonCard key={p.id} p={p} teams={data.teams} busy={busy} act={act} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">Deleted deals ({data.deleted.length})</h2>
        {data.deleted.length === 0 && <p className={`${card} text-sm text-slate-500`}>None. Deals deleted from now on wait here.</p>}
        {data.deleted.map((d) => (
          <div key={d.id} className={`${card} flex flex-wrap items-center justify-between gap-2`}>
            <p className="text-sm text-slate-800">
              <b>{d.name}</b> {d.stage ? `· ${d.stage}` : ""}
              <span className="ml-2 text-xs text-slate-500">
                deleted {when(d.deletedAt)} {d.deletedBy ? `by ${d.deletedBy}` : ""}
              </span>
            </p>
            <button disabled={busy || !d.fromTeamId} onClick={() => act({ action: "restoreDeal", dealId: d.id }, `Restored "${d.name}".`)} className={btn}>
              Restore
            </button>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-slate-900">Recent changes</h2>
        {data.recent.length === 0 && <p className={`${card} text-sm text-slate-500`}>Nothing yet. Every deletion and team change is recorded here from now on.</p>}
        {data.recent.map((c) => (
          <p key={c.id} className="rounded-lg border border-slate-100 bg-white px-4 py-2 text-sm text-slate-700">
            <span className="mr-2 text-xs text-slate-400">{when(c.createdAt)}</span>
            {label(c)}
          </p>
        ))}
      </section>
    </div>
  );
}

function PersonCard({
  p,
  teams,
  busy,
  act,
}: {
  p: Person;
  teams: Data["teams"];
  busy: boolean;
  act: (body: Record<string, unknown>, done: string) => Promise<void>;
}) {
  const otherTeams = [...new Map(p.createdDeals.filter((d) => d.onOtherTeam).map((d) => [d.teamId, d.teamName ?? d.teamId])).entries()];
  const [target, setTarget] = useState(otherTeams[0]?.[0] ?? "");
  return (
    <div className={`${card} flex flex-col gap-3`}>
      <div>
        <p className="text-sm font-semibold text-slate-900">
          {p.name || p.email} <span className="font-normal text-slate-500">{p.email}</span>
        </p>
        <p className="mt-1 text-xs text-slate-600">
          {p.team ? (
            <>
              On team <b>{p.team.name}</b>
              {p.team.isOwner ? " (owner)" : ""} · that team has {p.team.dealCount} deal(s)
            </>
          ) : (
            "Not on any team"
          )}
          {p.restrictedToDeals && <span className="ml-2 text-amber-700">· limited to selected deals ({p.dealGrants} granted)</span>}
        </p>
      </div>
      {p.createdDeals.length > 0 && (
        <div className="text-xs text-slate-700">
          <p className="font-medium">Deals they created ({p.createdDeals.length}):</p>
          <ul className="mt-1 list-disc pl-5">
            {p.createdDeals.slice(0, 30).map((d) => (
              <li key={d.id} className={d.deleted ? "text-red-600" : d.onOtherTeam ? "text-amber-700" : ""}>
                {d.name} {d.stage ? `· ${d.stage}` : ""} · {d.deleted ? "deleted (restore below)" : d.onOtherTeam ? `on another team: ${d.teamName}` : "on their team"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {otherTeams.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Their deals are on a team they&apos;re no longer on. Move them back to that team below and everything reappears.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value={target} onChange={(e) => setTarget(e.target.value)} className={input}>
          <option value="">Move to team…</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} {t.ownerEmail ? `(${t.ownerEmail})` : ""}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !target}
          onClick={() => act({ action: "move", userId: p.id, teamId: target, fullAccess: true }, `Moved ${p.email}. They'll see the team's deals on their next page load.`)}
          className={btn}
        >
          Move with full access
        </button>
      </div>
      {p.history.length > 0 && (
        <div className="text-xs text-slate-500">
          <p className="font-medium text-slate-600">History</p>
          {p.history.map((c) => (
            <p key={c.id}>
              {when(c.createdAt)} · {label(c)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
