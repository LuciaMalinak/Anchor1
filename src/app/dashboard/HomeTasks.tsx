"use client";

import { useState } from "react";
import Link from "next/link";
import { HEALTH_LABEL, HEALTH_DOT_CLASSES, type DealHealth } from "@/lib/dealHealth";

type HomeTask = {
  id: string;
  text: string;
  ownerLabel: string | null;
  completed: boolean;
  dealId: string | null;
  dealName: string | null;
  dealHealth: DealHealth | "none";
  daysSinceActivity: number | null;
  source: "meeting" | "manual";
  createdAt: string;
};

type Comment = {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string | null; email: string; image: string | null };
};

function healthDot(health: DealHealth | "none") {
  if (health === "none") return "bg-slate-300";
  return HEALTH_DOT_CLASSES[health];
}

function TaskComments({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      try {
        const res = await fetch(`/api/tasks/${taskId}/comments`);
        if (res.ok) {
          const body = await res.json();
          setComments(body.comments);
        }
      } finally {
        setLoaded(true);
      }
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't post that");
      setComments((prev) => [...prev, body.comment]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post that");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={toggle}
        className="text-[11px] font-medium text-slate-400 hover:text-brand"
      >
        {open ? "Hide comments" : comments.length > 0 ? `${comments.length} comment${comments.length === 1 ? "" : "s"}` : "Comment"}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg bg-slate-50 p-3">
          {comments.length === 0 && loaded && (
            <p className="text-xs text-slate-400">No comments yet.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="text-xs">
              <span className="font-medium text-slate-700">{c.author.name || c.author.email}</span>{" "}
              <span className="text-slate-500">{c.content}</span>
            </div>
          ))}
          <form onSubmit={handleSend} className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a comment…"
              className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-brand"
            />
            <button
              type="submit"
              disabled={sending}
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Post
            </button>
          </form>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function HomeTasks({
  initialTasks,
  deals,
}: {
  initialTasks: HomeTask[];
  deals: { id: string; name: string }[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [completing, setCompleting] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState("");
  const [newDealId, setNewDealId] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleComplete(id: string) {
    setCompleting(id);
    // Optimistic — it's a to-do list, the whole point is that checking
    // something off feels instant.
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      if (!res.ok) throw new Error("Couldn't check that off");
    } catch {
      // Put it back if the request failed.
      setTasks(initialTasks);
    } finally {
      setCompleting(null);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const text = newText.trim();
    if (!text) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, dealId: newDealId || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't add that task");
      const deal = deals.find((d) => d.id === newDealId);
      setTasks((prev) => [
        {
          id: body.task.id,
          text: body.task.text,
          ownerLabel: body.task.ownerLabel,
          completed: false,
          dealId: body.task.dealId,
          dealName: deal?.name ?? null,
          dealHealth: "none",
          daysSinceActivity: null,
          source: "manual",
          createdAt: body.task.createdAt,
        },
        ...prev,
      ]);
      setNewText("");
      setNewDealId("");
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that task");
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-slate-900">To do</h2>
          <p className="text-xs text-slate-500">
            Pulled from every meeting&apos;s action items, ranked by which deal needs attention most.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
        >
          {showAdd ? "Cancel" : "+ Add task"}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="What needs doing?"
            autoFocus
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="flex gap-2">
            <select
              value={newDealId}
              onChange={(e) => setNewDealId(e.target.value)}
              className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="">No specific deal</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={adding}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>
      )}

      <div className="mt-4 flex flex-col divide-y divide-slate-100">
        {tasks.length === 0 ? (
          <p className="py-4 text-sm text-slate-400">Nothing on the list right now.</p>
        ) : (
          tasks.map((t) => (
            <div key={t.id} className="flex gap-3 py-3">
              <button
                type="button"
                onClick={() => handleComplete(t.id)}
                disabled={completing === t.id}
                aria-label="Mark done"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 transition hover:border-brand disabled:opacity-50"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800">{t.text}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                  {t.ownerLabel && <span>{t.ownerLabel}</span>}
                  {t.dealId && t.dealName && (
                    <Link href={`/dashboard/deals/${t.dealId}`} className="flex items-center gap-1.5 hover:text-brand">
                      <span className={`h-1.5 w-1.5 rounded-full ${healthDot(t.dealHealth)}`} aria-hidden="true" />
                      {t.dealName}
                      {t.dealHealth !== "none" && t.dealHealth !== "on-track" && (
                        <span className="text-slate-400">— {HEALTH_LABEL[t.dealHealth]}</span>
                      )}
                    </Link>
                  )}
                </div>
                <TaskComments taskId={t.id} />
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
