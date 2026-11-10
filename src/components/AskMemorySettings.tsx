"use client";

import { useEffect, useState } from "react";

// Profile: what Ask Anchor has learned about how this person likes to
// work (src/lib/askMemory.ts), which they can read, edit or clear.
export function AskMemorySettings() {
  const [notes, setNotes] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/ask/memory")
      .then((r) => (r.ok ? r.json() : { notes: "" }))
      .then((d) => live && setNotes(d.notes ?? ""))
      .catch(() => live && setNotes(""));
    return () => {
      live = false;
    };
  }, []);

  async function save(method: "PUT" | "DELETE") {
    if (method === "DELETE" && !window.confirm("Clear everything Ask Anchor has learned about how you work? It starts learning again from your next questions.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ask/memory", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "PUT" ? { body: JSON.stringify({ notes: draft }) } : {}),
      });
      const d = await res.json().catch(() => ({ notes }));
      setNotes(d.notes ?? "");
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">What Ask Anchor knows about how you work</h2>
        <p className="text-sm text-slate-500">
          Ask Anchor learns from your questions and your thumbs up / down: how you like answers, models
          and decks, and facts you&apos;ve told it. Only you can see this. Say &quot;remember …&quot; in Ask
          Anchor to add something straight away.
        </p>
      </div>
      {notes === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            maxLength={1500}
            placeholder={"- Keep answers short, in bullets\n- Use USD in millions with one decimal\n- Models: 10-year hold, annual periods"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10"
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void save("PUT")} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-slate-500 hover:underline">
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          {notes ? (
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 font-sans text-sm text-slate-700">{notes}</pre>
          ) : (
            <p className="text-sm text-slate-400">Nothing yet — it learns as you use Ask Anchor.</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(notes);
                setEditing(true);
              }}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-brand hover:bg-slate-50"
            >
              {notes ? "Edit" : "Add your own"}
            </button>
            {notes && (
              <button type="button" disabled={busy} onClick={() => void save("DELETE")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                Clear
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
