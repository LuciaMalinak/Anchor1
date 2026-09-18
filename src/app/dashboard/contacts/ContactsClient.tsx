"use client";

import { useState } from "react";
import Link from "next/link";

type Contact = {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  relationshipSummary: string | null;
  meetingCount: number;
};

function InitialsAvatar({ label, size = 40 }: { label: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {label[0]?.toUpperCase() || "?"}
    </span>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m-6.5 0 .6 9.4A1.5 1.5 0 0 0 7.6 17h4.8a1.5 1.5 0 0 0 1.5-1.6L14.5 6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ContactsClient({ initialContacts }: { initialContacts: Contact[] }) {
  const [contacts, setContacts] = useState(initialContacts);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(e: React.MouseEvent, id: string, name: string) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        `Remove ${name} from your contacts? Anchor will stop tracking history for them — past meeting summaries and transcripts are untouched.`
      )
    ) {
      return;
    }
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't remove this contact");
      }
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove this contact");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-brand">Contacts</h1>
        <p className="text-sm text-slate-500">
          Everyone Anchor has recognized across your meetings, with what it&apos;s learned about each.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {contacts.length === 0 ? (
        <p className="text-sm text-slate-500">
          No one yet — Anchor builds this automatically as it recognizes speakers in your meetings.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {contacts.map((c) => (
            <div key={c.id} className="group relative">
              <Link
                href={`/dashboard/contacts/${c.id}`}
                className="card-hover flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 pr-9 shadow-sm hover:border-slate-300"
              >
                <InitialsAvatar label={c.name} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{c.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[c.role, c.company].filter(Boolean).join(" · ") || "No details yet"}
                  </p>
                  {c.relationshipSummary && (
                    <p className="mt-1.5 line-clamp-2 text-xs text-slate-600">{c.relationshipSummary}</p>
                  )}
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {c.meetingCount} meeting{c.meetingCount === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
              <button
                type="button"
                onClick={(e) => handleDelete(e, c.id, c.name)}
                disabled={deletingId === c.id}
                aria-label={`Remove ${c.name}`}
                title="Remove contact"
                className="absolute right-2 top-2 rounded-md p-1.5 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 group-hover:opacity-100"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
