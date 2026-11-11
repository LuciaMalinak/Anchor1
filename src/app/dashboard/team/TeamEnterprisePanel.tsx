"use client";

import { useEffect, useState } from "react";

type Activity = { at: string; who: string; action: string; what: string };
type Data = { retentionDays: number | null; retentionChoices: number[]; doNotRecord: string[]; activity: Activity[] };

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Team owner only (the API refuses anyone else): automatic deletion of
// old calls, the do-not-record list and the team's activity log — the
// controls a client's IT or legal team asks about.
export function TeamEnterprisePanel() {
  const [data, setData] = useState<Data | null>(null);
  const [retention, setRetention] = useState<string>("keep");
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/team/enterprise")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Data | null) => {
        if (!live || !d) return;
        setData(d);
        setRetention(d.retentionDays ? String(d.retentionDays) : "keep");
        setList(d.doNotRecord.join("\n"));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/team/enterprise", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't save");
      if (Array.isArray(d.doNotRecord)) setList(d.doNotRecord.join("\n"));
      setNote(done);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  function saveRetention() {
    const days = retention === "keep" ? null : Number(retention);
    if (days && !window.confirm(`Delete every call older than ${days} days for good, now and from here on? This includes recordings, transcripts and summaries, and can't be undone.`)) return;
    void save({ retentionDays: days }, days ? `Calls older than ${days} days will be deleted automatically, starting within a few hours.` : "Calls are kept until someone deletes them.");
  }

  return (
    <section className="flex flex-col gap-6 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Client confidentiality controls</h2>
        <p className="text-sm text-slate-500">
          Only you, as team owner, see this. These are the controls clients&apos; IT and legal teams ask about.
        </p>
      </div>

      {!data ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-slate-800">Delete old calls automatically</h3>
            <p className="text-sm text-slate-500">
              Recordings, transcripts and summaries older than this are deleted for good, including the copy kept for
              recovering a deleted call. Deal notes Anchor.AI has already written stay.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-800"
              >
                <option value="keep">Keep until someone deletes them</option>
                {data.retentionChoices.map((d) => (
                  <option key={d} value={String(d)}>
                    After {d} days
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={saveRetention}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-slate-800">Do-not-record list</h3>
            <p className="text-sm text-slate-500">
              Clients, companies or email domains Anchor.AI must never record, one per line (for example{" "}
              <span className="font-mono text-xs">acme.com</span> or <span className="font-mono text-xs">Acme Holdings</span>).
              A call is blocked when its title, its deal&apos;s name, website or contact&apos;s email domain matches. The
              notetaker won&apos;t join, the desktop app won&apos;t record and uploads are refused.
            </p>
            <textarea
              value={list}
              onChange={(e) => setList(e.target.value)}
              rows={4}
              placeholder={"acme.com\nAcme Holdings"}
              className="w-full max-w-lg rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-800"
            />
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={() => save({ doNotRecord: list.split("\n") }, "Do-not-record list saved.")}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                Save list
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-800">Activity log</h3>
              <a
                href="/api/team/enterprise?format=csv"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-brand hover:bg-slate-50"
              >
                Download as CSV
              </a>
            </div>
            <p className="text-sm text-slate-500">
              Who signed in, opened, shared, downloaded, deleted or changed what. The latest 200 are shown here; the
              download has more.
            </p>
            {data.activity.length ? (
              <div className="max-h-80 overflow-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="sticky top-0 bg-white text-xs text-slate-500">
                    <tr className="border-b border-slate-100">
                      <th className="py-2 pr-3 font-medium">When</th>
                      <th className="py-2 pr-3 font-medium">Who</th>
                      <th className="py-2 pr-3 font-medium">What</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activity.map((a, i) => (
                      <tr key={i} className="border-b border-slate-50 last:border-0 align-top">
                        <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{when(a.at)}</td>
                        <td className="py-2 pr-3 text-slate-700">{a.who}</td>
                        <td className="py-2 pr-3 text-slate-700">
                          {a.action}
                          {a.what && <span className="text-slate-500"> · {a.what}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Nothing recorded yet.</p>
            )}
          </div>
        </>
      )}
      {note && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{note}</p>}
    </section>
  );
}
