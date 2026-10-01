"use client";

import { useState } from "react";

// "Share next steps" on a deal's After tab: makes a 30-day link to a
// customer-facing page with just the agreed action items (ticked off as
// the team completes them) and any scheduled calls.
export function ShareNextSteps({ dealId, disabled }: { dealId: string; disabled: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/share-link`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't make the link");
      setUrl(body.url);
      setExpiresAt(body.expiresAt);
      try {
        await navigator.clipboard.writeText(body.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        // Clipboard blocked: the link is shown below to copy by hand.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make the link");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 px-5 py-5">
      <p className="text-[11px] font-semibold tracking-[0.15em] text-accent">SHARE NEXT STEPS</p>
      <p className="mt-2 text-sm text-slate-600">
        A link for the customer with what you both agreed on the last call and who owns each step. It updates as
        tasks are ticked off. No notes or internal signals are shown.
      </p>
      <button
        type="button"
        onClick={create}
        disabled={loading || disabled}
        className="mt-4 w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50"
      >
        {loading ? "Making the link…" : copied ? "Link copied ✓" : url ? "Copy a new link" : "Copy share link"}
      </button>
      {url && (
        <div className="mt-3 flex flex-col gap-1">
          <label htmlFor={`share-url-${dealId}`} className="sr-only">
            Share link
          </label>
          <input
            id={`share-url-${dealId}`}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600"
          />
          <p className="text-xs text-slate-400">
            Anyone with this link can view it until{" "}
            {expiresAt ? new Date(expiresAt).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : "it expires"}.{" "}
            <a href={url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
              Preview ↗
            </a>
          </p>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
