"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// LinkedIn URL field plus an optional "paste their profile text in" box
// that runs it through Anchor's AI to fill in title/company/summary. Not
// an automated LinkedIn connection — see the comment on this route in
// src/app/api/contacts/[id]/linkedin/route.ts for why that's not something
// this app can do — every bit of profile info here comes from a teammate
// pasting it in themselves.
export function ContactLinkedIn({
  contactId,
  initialLinkedinUrl,
}: {
  contactId: string;
  initialLinkedinUrl: string | null;
}) {
  const router = useRouter();
  const [linkedinUrl, setLinkedinUrl] = useState(initialLinkedinUrl || "");
  const [pastedText, setPastedText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/linkedin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedinUrl: linkedinUrl.trim(), pastedText: pastedText.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't save that");
      setNotice(
        pastedText.trim()
          ? "Saved — pulled their title, company, and a summary in below."
          : "Saved."
      );
      setPastedText("");
      setShowPaste(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900">LinkedIn</p>
        {linkedinUrl && (
          <a
            href={linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs font-medium text-brand hover:underline"
          >
            Open profile ↗
          </a>
        )}
      </div>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
        <input
          type="url"
          value={linkedinUrl}
          onChange={(e) => setLinkedinUrl(e.target.value)}
          placeholder="https://www.linkedin.com/in/…"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        {showPaste ? (
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste the text from their LinkedIn profile — headline, About, Experience, whatever you've got — and Anchor will pull out their title, company, and a short summary."
            rows={6}
            autoFocus
            className="resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            className="self-start text-xs font-medium text-brand hover:underline"
          >
            Paste their profile to auto-fill title, company & a summary
          </button>
        )}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || (!linkedinUrl.trim() && !pastedText.trim())}
            className="self-start rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {showPaste && (
            <button
              type="button"
              onClick={() => {
                setShowPaste(false);
                setPastedText("");
              }}
              className="text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {notice && <p className="mt-2 text-xs text-emerald-600">{notice}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <p className="mt-3 text-[11px] text-slate-400">
        Anchor can&apos;t pull data about other people directly from LinkedIn — its API only ever
        shares the profile of whoever signs in, and using it to enrich contacts isn&apos;t allowed
        by LinkedIn&apos;s own terms. Paste in what you see on their profile instead and Anchor will
        do the rest.
      </p>
    </section>
  );
}
