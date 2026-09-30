"use client";

import { useState } from "react";

// googleConfigured: the server has Google credentials set, so "Save to
// Gmail drafts" can work (it asks for Gmail permission on first use).
export function FollowUpEmailDraft({
  meetingId,
  googleConfigured,
}: {
  meetingId: string;
  googleConfigured: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientEmails, setRecipientEmails] = useState<string[]>([]);
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [gmailState, setGmailState] = useState<"idle" | "saving" | "saved">("idle");
  const [gmailUrl, setGmailUrl] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/follow-up-draft`, { method: "POST" });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseBody.error || "Couldn't draft the email");
      setSubject(responseBody.draft.subject);
      setBody(responseBody.draft.body);
      setRecipientEmails(responseBody.recipientEmails || []);
      setGenerated(true);
      setGmailState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draft the email");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (e.g. non-HTTPS, permissions) —
      // the text is still right there in the boxes to select by hand.
    }
  }

  async function handleSaveToGmail() {
    setGmailState("saving");
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/gmail-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: recipientEmails, subject, body }),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (res.status === 403 && responseBody.connectUrl) {
        // First use: Google asks for Gmail permission, then brings them
        // back here to click again.
        window.location.href = responseBody.connectUrl;
        return;
      }
      if (!res.ok) throw new Error(responseBody.error || "Couldn't save to Gmail");
      setGmailUrl(responseBody.openUrl);
      setGmailState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save to Gmail");
      setGmailState("idle");
    }
  }

  const mailtoHref = `mailto:${recipientEmails.join(",")}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;

  return (
    <section className="rounded-xl border border-slate-200 border-l-4 border-l-accent bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2>Follow-up email</h2>
          <p className="mt-1 text-xs text-slate-500">
            A draft Anchor writes from this meeting&apos;s summary — review it before sending; nothing
            goes out on its own.
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-dark disabled:opacity-50"
        >
          {loading ? "Drafting…" : generated ? "Regenerate" : "Draft a follow-up email"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {generated && (
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          {recipientEmails.length === 0 && (
            <p className="text-xs text-amber-600">
              No email address on file for anyone in this meeting — add one on their contact page,
              or fill it in yourself in Gmail or your email client.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
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
                  onClick={handleSaveToGmail}
                  disabled={gmailState === "saving" || !subject.trim() || !body.trim()}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
                >
                  {gmailState === "saving" ? "Saving…" : "Save to Gmail drafts"}
                </button>
              ))}
            <a
              href={mailtoHref}
              className={
                googleConfigured
                  ? "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
                  : "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark"
              }
            >
              Open in email client
            </a>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
            >
              {copied ? "Copied!" : "Copy text"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
