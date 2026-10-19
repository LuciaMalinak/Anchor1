"use client";

import { useState } from "react";

type Entry = {
  id: string;
  question: string;
  answer: string;
  source: "call" | "taught";
  dealName: string | null;
  updatedAt: string;
};

const input = "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand";

export function PlaybookClient({ initial, deals }: { initial: Entry[]; deals: { id: string; name: string }[] }) {
  const [entries, setEntries] = useState(initial);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [dealId, setDealId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const res = await fetch("/api/playbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer, dealId: dealId || null }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok || !body.entry) {
      setError(body.error || "Couldn't save it.");
      return;
    }
    const dealName = deals.find((d) => d.id === dealId)?.name ?? null;
    setEntries((list) => [
      { ...body.entry, dealName, updatedAt: body.entry.updatedAt },
      ...list.filter((e) => e.id !== body.entry.id),
    ]);
    setQuestion("");
    setAnswer("");
    setAdding(false);
  }

  const q = filter.trim().toLowerCase();
  const shown = q ? entries.filter((e) => `${e.question} ${e.answer} ${e.dealName ?? ""}`.toLowerCase().includes(q)) : entries;
  const learned = entries.filter((e) => e.source === "call").length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Playbook</h1>
        <p className="mt-1 text-sm text-slate-500">
          How your team answers what clients ask. Anchor learns these by itself from every call ({learned} so far), and from
          the 👍 / 👎 under live answers. During calls it answers the way these say. Fix anything that&apos;s off — your
          answers always win over what it learned.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search questions and answers…" className={`${input} max-w-xs`} />
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
        >
          Teach Anchor an answer
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="When a client asks… (e.g. Do you integrate with HubSpot?)" className={input} />
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} placeholder="…answer like this" className={input} />
          <div className="flex flex-wrap items-center gap-2">
            <select value={dealId} onChange={(e) => setDealId(e.target.value)} className={`${input} w-auto`}>
              <option value="">Every deal</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  Only {d.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={add} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
              Save
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-sm text-slate-400 hover:text-slate-600">
              Cancel
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
          {entries.length ? "Nothing matches that search." : "Nothing yet — Anchor starts learning from your next call."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((e) => (
            <PlaybookRow
              key={e.id}
              entry={e}
              onSaved={(next) => setEntries((list) => list.map((x) => (x.id === next.id ? { ...x, ...next } : x)))}
              onDeleted={() => setEntries((list) => list.filter((x) => x.id !== e.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PlaybookRow({
  entry,
  onSaved,
  onDeleted,
}: {
  entry: Entry;
  onSaved: (e: Partial<Entry> & { id: string }) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(entry.question);
  const [answer, setAnswer] = useState(entry.answer);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/playbook/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      onSaved({ id: entry.id, question, answer, source: "taught" });
      setEditing(false);
    }
  }

  async function remove() {
    if (!confirm("Remove this answer from the playbook?")) return;
    setBusy(true);
    const res = await fetch(`/api/playbook/${entry.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (res?.ok) onDeleted();
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      {editing ? (
        <div className="flex flex-col gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} className={input} />
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} className={input} />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={save} className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-slate-400 hover:text-slate-600">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-slate-900">{entry.question}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                entry.source === "taught" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
              }`}
            >
              {entry.source === "taught" ? "Taught" : "Learned from a call"}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{entry.answer}</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
            <span>{entry.dealName ? `Only ${entry.dealName}` : "Every deal"}</span>
            <button type="button" onClick={() => setEditing(true)} className="font-medium text-brand hover:underline">
              Edit
            </button>
            <button type="button" disabled={busy} onClick={remove} className="hover:text-red-600">
              Remove
            </button>
          </div>
        </>
      )}
    </li>
  );
}
