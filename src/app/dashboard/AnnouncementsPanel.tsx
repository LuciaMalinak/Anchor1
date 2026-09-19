"use client";

import Image from "next/image";
import { useState } from "react";

export type Announcement = {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string | null; email: string; image: string | null };
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Team-wide, not deal-specific — leadership's spot to post something
// everyone on the team should see (a policy change, a win, a heads up)
// without it getting buried in one deal's chat. Only the team owner can
// post or remove one (isTeamOwner, computed server-side in page.tsx);
// everyone sees the same feed. Also folded into the daily text digest —
// see src/lib/dailyDigest.ts.
export function AnnouncementsPanel({
  initialAnnouncements,
  isTeamOwner,
}: {
  initialAnnouncements: Announcement[];
  isTeamOwner: boolean;
}) {
  const [announcements, setAnnouncements] = useState(initialAnnouncements);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't post that");
      setAnnouncements((prev) => [body.announcement, ...prev]);
      setDraft("");
      setComposing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post that");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this announcement for everyone?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/announcements/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't remove that");
      }
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that");
    } finally {
      setDeletingId(null);
    }
  }

  if (announcements.length === 0 && !isTeamOwner) return null;

  return (
    <section className="rounded-xl border border-slate-200 border-l-4 border-l-amber-400 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-slate-900">From leadership</h2>
          <p className="text-xs text-slate-500">Team-wide announcements — also sent in the morning digest.</p>
        </div>
        {isTeamOwner && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
          >
            Post announcement
          </button>
        )}
      </div>

      {composing && (
        <form onSubmit={handlePost} className="mt-3 flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What should the whole team know?"
            rows={3}
            autoFocus
            className="resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={posting || !draft.trim()}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {posting ? "Posting…" : "Post to the whole team"}
            </button>
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                setDraft("");
              }}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-4 flex flex-col gap-3">
        {announcements.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing posted yet.</p>
        ) : (
          announcements.map((a) => {
            const label = a.author.name || a.author.email;
            return (
              <div key={a.id} className="flex items-start gap-2 rounded-lg bg-amber-50/60 px-3 py-2">
                {a.author.image ? (
                  <Image
                    src={a.author.image}
                    alt=""
                    width={24}
                    height={24}
                    unoptimized
                    className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-white">
                    {label[0]?.toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-700">{label}</span>
                    <span className="text-[11px] text-slate-400">{timeAgo(a.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{a.content}</p>
                </div>
                {isTeamOwner && (
                  <button
                    type="button"
                    onClick={() => handleDelete(a.id)}
                    disabled={deletingId === a.id}
                    className="shrink-0 text-[11px] text-slate-400 hover:text-red-600 disabled:opacity-50"
                    title="Remove this announcement"
                  >
                    {deletingId === a.id ? "…" : "Remove"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
