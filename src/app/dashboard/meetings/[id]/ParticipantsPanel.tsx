"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Participant = {
  id: string;
  speakerLabel: string;
  displayName: string | null;
  relationshipSummary: string | null;
  meetingCount: number | null;
};

export function ParticipantsPanel({
  meetingId,
  participants,
  canEdit,
}: {
  meetingId: string;
  participants: Participant[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function startEditing(p: Participant) {
    setEditingId(p.id);
    setDraft(p.displayName || "");
    setErrors((e) => ({ ...e, [p.id]: "" }));
  }

  async function save(participantId: string) {
    setSavingId(participantId);
    setErrors((e) => ({ ...e, [participantId]: "" }));
    try {
      const res = await fetch(`/api/meetings/${meetingId}/participants/${participantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: draft }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save that name");
      }
      setEditingId(null);
      // Re-fetches this whole page from the server, which re-derives the
      // transcript's speaker labels from the same participants rows too —
      // see page.tsx's speakerNames map — so the corrected name shows up
      // in both places at once, not just here.
      router.refresh();
    } catch (err) {
      setErrors((e) => ({ ...e, [participantId]: err instanceof Error ? err.message : "Couldn't save that name" }));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-medium text-slate-900">People in this meeting</h2>
      <div className="mt-3 flex flex-col gap-3">
        {participants.map((p) => (
          <div key={p.id} className="rounded-lg bg-slate-50 px-4 py-3">
            {editingId === p.id ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save(p.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  placeholder={p.speakerLabel}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand"
                />
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => save(p.id)}
                    disabled={savingId === p.id}
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {savingId === p.id ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">
                  {p.displayName || p.speakerLabel}
                  {!p.displayName && (
                    <span className="ml-2 text-xs font-normal text-slate-400">unidentified voice</span>
                  )}
                  {Boolean(p.meetingCount && p.meetingCount > 1) && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {p.meetingCount} meetings
                    </span>
                  )}
                </p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => startEditing(p)}
                    className="shrink-0 text-xs font-medium text-brand hover:underline"
                  >
                    {p.displayName ? "Rename" : "Add name"}
                  </button>
                )}
              </div>
            )}
            {p.relationshipSummary && editingId !== p.id && (
              <p className="mt-1 text-sm text-slate-600">{p.relationshipSummary}</p>
            )}
            {errors[p.id] && <p className="mt-1 text-xs text-red-600">{errors[p.id]}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
