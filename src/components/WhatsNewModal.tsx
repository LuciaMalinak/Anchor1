"use client";

import { useEffect, useRef, useState } from "react";
import { AnchorMark } from "@/components/Logo";

// The current "what's new" announcement. Changing RELEASE_ID shows the
// popup again, once, to every returning member; see WHATS_NEW_CUTOFF in
// src/app/dashboard/layout.tsx for who counts as returning.
export const RELEASE_ID = "2026-10-ask-anchor-everywhere";
const STORAGE_KEY = "anchor.whatsNew.seen";

// New tools only, each with where to find it. Keep this to things a
// member can use today.
const TOOLS = [
  {
    title: "Ask Anchor, on every page",
    body: "It's on the right of every page now (⌘K). Ask about any deal, call or person: on a deal it knows that deal, on a recap it knows that call word for word.",
  },
  {
    title: "Prep me for the next call",
    body: "On a deal's Before tab: who matters, what's still open, what to ask and what to watch out for.",
  },
  {
    title: "Deals going quiet",
    body: "Home flags deals with no call in 10+ days and promises still open from calls. Click Draft a nudge for a ready-to-send check-in in your Gmail drafts.",
  },
  {
    title: "Update Salesforce or HubSpot",
    body: "On a meeting recap, Anchor suggests the stage, close date, amount and next step the call changed. Only what you approve is written.",
  },
  {
    title: "Share next steps",
    body: "On a deal's After tab, copy a link for your customer with what you both agreed and who owns each step. It ticks off as you go.",
  },
];

// Shown once to returning members after a release. Closes on the button,
// the ×, Escape or a click outside. "Seen" is remembered in this browser,
// and set as soon as it opens, so it never shows twice even if they
// navigate away.
export function WhatsNewModal() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(STORAGE_KEY) === RELEASE_ID;
    } catch {
      // Storage blocked (private mode): show it, it just can't be remembered.
    }
    if (seen) return;
    // A short beat after the page appears, so it doesn't flash in mid-load.
    const t = setTimeout(() => {
      setOpen(true);
      try {
        localStorage.setItem(STORAGE_KEY, RELEASE_ID);
      } catch {}
    }, 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="enter-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
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

        <div className="flex items-center gap-2">
          <AnchorMark size={20} />
          <span className="text-xs font-medium uppercase tracking-wide text-accent">What&apos;s new</span>
        </div>
        <h2 id="whats-new-title" className="mt-2 text-xl font-semibold text-brand">
          New tools in Anchor
        </h2>
        <ul className="mt-4 flex flex-col gap-3">
          {TOOLS.map((t) => (
            <li key={t.title} className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-900">{t.title}</p>
              <p className="mt-1 text-sm text-slate-600">{t.body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-dark"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
