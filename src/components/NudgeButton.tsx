"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  stashPendingGoogleAction,
  takePendingGoogleAction,
} from "@/lib/pendingGoogleAction";

type Draft = { subject: string; body: string; recipientEmails: string[] };

// "Draft a nudge" for a deal that's gone quiet: Anchor writes a short,
// specific check-in from what it knows about the deal; the user edits it
// and saves it to Gmail drafts (or opens it in their own email app). Like
// the meeting follow-up, nothing is ever sent from here.
export function NudgeButton({
  dealId,
  dealName,
  googleConfigured,
  returnTo,
}: {
  dealId: string;
  dealName: string;
  googleConfigured: boolean;
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [gmailState, setGmailState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [gmailUrl, setGmailUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Back from granting Gmail permission: reopen with the same draft and
  // finish saving it.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = takePendingGoogleAction<Draft>("nudge", dealId);
    if (!pending) return;
    queueMicrotask(() => {
      setDraft(pending);
      setOpen(true);
      void save(pending, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function generate() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setGmailState("idle");
    try {
      const res = await fetch(`/api/deals/${dealId}/nudge`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't draft the nudge");
      setDraft({
        subject: body.draft.subject,
        body: body.draft.body,
        recipientEmails: body.recipientEmails ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draft the nudge");
    } finally {
      setLoading(false);
    }
  }

  async function save(d: Draft, afterPermission = false) {
    setGmailState("saving");
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/gmail-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: d.recipientEmails,
          subject: d.subject,
          body: d.body,
          returnTo,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && body.connectUrl) {
        if (afterPermission) {
          throw new Error(
            "Anchor needs permission to create Gmail drafts. Click Save to Gmail drafts and allow it on Google's screen.",
          );
        }
        stashPendingGoogleAction("nudge", dealId, d);
        window.location.href = body.connectUrl;
        return;
      }
      if (!res.ok) throw new Error(body.error || "Couldn't save to Gmail");
      setGmailUrl(body.openUrl);
      setGmailState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save to Gmail");
      setGmailState("idle");
    }
  }

  function update(patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setGmailState("idle");
  }

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(
        `Subject: ${draft.subject}\n\n${draft.body}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the text is still in the boxes to copy by hand.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={generate}
        className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand hover:text-brand"
      >
        Draft a nudge
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
            onClick={() => setOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={`nudge-title-${dealId}`}
              className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ×
              </button>
              <h2
                id={`nudge-title-${dealId}`}
                className="text-lg font-semibold text-brand"
              >
                Nudge for {dealName}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Written from this deal&apos;s meetings and notes. Review it
                first; nothing is sent.
              </p>
              {loading && (
                <p className="mt-6 text-sm text-slate-500">Drafting…</p>
              )}
              {draft && !loading && (
                <div className="mt-4 flex flex-col gap-3">
                  <p className="text-xs text-slate-500">
                    To:{" "}
                    {draft.recipientEmails.length
                      ? draft.recipientEmails.join(", ")
                      : "no email on file — add one in Gmail"}
                  </p>
                  <label
                    className="text-xs font-medium uppercase tracking-wide text-slate-500"
                    htmlFor={`nudge-subject-${dealId}`}
                  >
                    Subject
                  </label>
                  <input
                    id={`nudge-subject-${dealId}`}
                    value={draft.subject}
                    onChange={(e) => update({ subject: e.target.value })}
                    className="-mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <label
                    className="text-xs font-medium uppercase tracking-wide text-slate-500"
                    htmlFor={`nudge-body-${dealId}`}
                  >
                    Body
                  </label>
                  <textarea
                    id={`nudge-body-${dealId}`}
                    value={draft.body}
                    onChange={(e) => update({ body: e.target.value })}
                    rows={9}
                    className="-mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <div className="flex flex-wrap gap-2">
                    {googleConfigured &&
                      (gmailState === "saved" && gmailUrl ? (
                        <a
                          href={gmailUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700"
                        >
                          Saved to Gmail drafts ↗
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void save(draft)}
                          disabled={
                            gmailState === "saving" ||
                            !draft.subject.trim() ||
                            !draft.body.trim()
                          }
                          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-dark disabled:opacity-50"
                        >
                          {gmailState === "saving"
                            ? "Saving…"
                            : "Save to Gmail drafts"}
                        </button>
                      ))}
                    <a
                      href={`mailto:${draft.recipientEmails.join(",")}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
                    >
                      Open in email app
                    </a>
                    <button
                      type="button"
                      onClick={copy}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                    <button
                      type="button"
                      onClick={generate}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
                    >
                      Rewrite
                    </button>
                  </div>
                </div>
              )}
              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
