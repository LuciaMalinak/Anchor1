"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveMeeting } from "@/lib/useLiveMeeting";
import { AskAnchorPanel } from "@/components/AskAnchorPanel";
import { StopMeetingButton } from "@/components/StopMeetingButton";
import { FOCUS_WIDGETS, type FocusWidgetKey } from "@/lib/focusWidgets";

// How long the "meeting ended" notice sits on screen before this window
// closes itself — long enough to read, short enough that it doesn't just
// linger afterward. "Keep this window open" cancels it.
const AUTO_CLOSE_MS = 8_000;

export function FocusWindow({
  meetingId,
  meetingTitle,
  dealId,
  dealName,
  stage,
  primaryContactName,
  primaryContactRole,
  decisionBoundaries,
  initialWidgets,
  onClose,
}: {
  meetingId: string;
  meetingTitle: string;
  dealId: string | null;
  dealName: string | null;
  stage: string | null;
  primaryContactName: string | null;
  primaryContactRole: string | null;
  decisionBoundaries: string | null;
  initialWidgets: FocusWidgetKey[];
  // Closes THIS window. Defaults to a plain window.close(), which is
  // correct for the ordinary popup (src/app/focus/[meetingId]/page.tsx —
  // its own real browser window). The Picture-in-Picture launcher (see
  // src/lib/useFocusWindow.ts) overrides this to close the PiP window
  // instead: this component's code keeps running in the OPENER page's JS
  // realm when portaled into a PiP window, so a bare window.close() in
  // here would otherwise try to close the wrong window.
  onClose?: () => void;
}) {
  const { segments, suggestions, status } = useLiveMeeting(meetingId);
  const [widgets, setWidgets] = useState<Set<FocusWidgetKey>>(new Set(initialWidgets));
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState<Set<FocusWidgetKey>>(new Set(initialWidgets));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [closeCancelled, setCloseCancelled] = useState(false);

  const stillLive = status === "joining" || status === "recording" || status === null;
  const failed = status === "failed";
  // Fully derived from status, rather than tracked in its own state: the
  // moment the meeting actually ends (status moves off "joining"/
  // "recording" — see useLiveMeeting, which itself stops polling right
  // here), Anchor's already processing the recording in the background —
  // the summary lands in this deal's After tab on its own once that
  // finishes, same pipeline a manual upload goes through. This window has
  // nothing left to do, so it closes itself a few seconds later (below)
  // instead of sitting there indefinitely.
  const autoClosing = Boolean(status) && !stillLive && !closeCancelled;

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!autoClosing) return;
    const t = setTimeout(() => (closeRef.current ?? (() => window.close()))(), AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [autoClosing]);

  function openCustomize() {
    setDraft(new Set(widgets));
    setSaveError(null);
    setCustomizing(true);
  }

  function toggleDraft(key: FocusWidgetKey) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function saveCustomize() {
    if (draft.size === 0) {
      setSaveError("Keep at least one widget on.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/profile/focus-widgets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focusWidgets: [...draft] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't save that.");
      setWidgets(new Set(draft));
      setCustomizing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{meetingTitle}</p>
          <p className="text-xs text-slate-400">
            {stillLive ? "Focus mode — live" : "This meeting has ended"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Ends Anchor's bot early instead of waiting for the call to
              end on its own — see StopMeetingButton's comment for why
              this doesn't hang up the call for anyone else. Only while
              still live; once it's ended the auto-close notice below
              takes over. */}
          {stillLive && status && <StopMeetingButton meetingId={meetingId} variant="solid" />}
          <button
            type="button"
            onClick={openCustomize}
            className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700"
          >
            Customize
          </button>
        </div>
      </header>

      {customizing && (
        <div className="border-b border-slate-200 bg-white px-4 py-4">
          <p className="mb-3 text-xs font-medium text-slate-500">
            Show in this window — just for you, doesn&apos;t change anyone else&apos;s.
          </p>
          <div className="flex flex-col gap-3">
            {FOCUS_WIDGETS.map((w) => (
              <label key={w.key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.has(w.key)}
                  onChange={() => toggleDraft(w.key)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-slate-800">{w.label}</span>
                  <span className="block text-xs text-slate-500">{w.description}</span>
                </span>
              </label>
            ))}
          </div>
          {saveError && <p className="mt-3 text-xs text-red-600">{saveError}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={saveCustomize}
              disabled={saving}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setCustomizing(false)}
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {autoClosing && (
          <div
            className={`rounded-lg border px-3 py-3 ${
              failed ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"
            }`}
          >
            <p className={`text-sm font-medium ${failed ? "text-amber-800" : "text-emerald-800"}`}>
              {failed ? "Meeting ended — processing hit a snag" : "Meeting ended"}
            </p>
            <p className={`mt-1 text-xs ${failed ? "text-amber-700" : "text-emerald-700"}`}>
              {failed
                ? "Anchor had trouble processing this recording — check the After tab for details."
                : "Anchor's processing the recording now — the summary will show up in this deal's After tab shortly."}{" "}
              Closing this window…
            </p>
            <button
              type="button"
              onClick={() => setCloseCancelled(true)}
              className={`mt-2 rounded-md border px-2.5 py-1 text-xs font-medium ${
                failed
                  ? "border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
                  : "border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100"
              }`}
            >
              Keep this window open
            </button>
          </div>
        )}

        {widgets.has("keyFacts") && (dealName || primaryContactName || decisionBoundaries) && (
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-accent">
              KEY FACTS
            </p>
            <div className="flex flex-col gap-1.5 text-sm text-slate-700">
              {dealName && (
                <p>
                  <span className="font-medium text-slate-900">{dealName}</span>
                  {stage ? ` — ${stage}` : ""}
                </p>
              )}
              {primaryContactName && (
                <p>
                  {primaryContactName}
                  {primaryContactRole ? `, ${primaryContactRole}` : ""}
                </p>
              )}
              {decisionBoundaries && (
                <p className="text-xs text-slate-500">
                  <span className="font-medium text-slate-600">Can decide on your own: </span>
                  {decisionBoundaries}
                </p>
              )}
            </div>
          </section>
        )}

        {widgets.has("coaching") && suggestions?.liveQuestion && (
          <section className="rounded-lg border border-brand/30 bg-brand/5 p-3">
            <p className="mb-1 text-[11px] font-semibold tracking-[0.15em] text-brand">
              THEY JUST ASKED
            </p>
            <p className="text-xs italic text-slate-500">
              &ldquo;{suggestions.liveQuestion.question}&rdquo;
            </p>
            <p className="mt-1.5 text-sm font-medium text-slate-900">
              {suggestions.liveQuestion.suggestedAnswer}
            </p>
          </section>
        )}

        {widgets.has("coaching") && (
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-accent">
              SUGGESTIONS
            </p>
            {!suggestions ? (
              <p className="text-sm text-slate-500">Preparing suggestions…</p>
            ) : suggestions.nudges.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nothing to go on yet for this deal — no prep notes, history, or conversation so
                far. This fills in the moment any of those show up.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {suggestions.nudges.map((n, i) => (
                  <li key={i} className="rounded-md bg-accent/10 px-3 py-2 text-sm text-slate-800">
                    {n}
                  </li>
                ))}
              </ul>
            )}
            {suggestions && suggestions.checklist.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-semibold tracking-[0.15em] text-accent">
                  TO COVER
                </p>
                <ul className="flex flex-col gap-1.5">
                  {suggestions.checklist.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                          c.covered ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {c.covered ? "✓" : ""}
                      </span>
                      <span className={c.covered ? "text-slate-400 line-through" : "text-slate-700"}>
                        {c.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {widgets.has("askAnchor") &&
          (dealId ? (
            <AskAnchorPanel dealId={dealId} />
          ) : (
            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">
                Ask Anchor needs this meeting to be attached to a deal — this one isn&apos;t.
              </p>
            </section>
          ))}

        {widgets.has("transcript") && (
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-accent">
              LIVE TRANSCRIPT
            </p>
            {segments.length === 0 ? (
              <p className="text-sm text-slate-500">
                Waiting for the conversation to start — this fills in as people speak.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {segments.map((s) => (
                  <p key={s.id} className="text-sm text-slate-700">
                    {s.speakerName && <span className="font-medium text-slate-900">{s.speakerName}: </span>}
                    {s.text}
                  </p>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
