"use client";

import { useEffect, useRef, useState } from "react";
import { AnchorMark } from "@/components/Logo";

// The current "what's new" announcement. Changing RELEASE_ID shows the
// popup again, once, to every returning member; see WHATS_NEW_CUTOFF in
// src/app/dashboard/layout.tsx for who counts as returning.
export const RELEASE_ID = "2026-10-new-anchor";
const STORAGE_KEY = "anchor.whatsNew.seen";

const HIGHLIGHTS = [
  { title: "A calmer, clearer look", body: "Serif headlines, a softer canvas and recaps you can read at a glance." },
  { title: "Follow-ups in your drafts", body: "Save the follow-up email to Gmail and add agreed meetings to your calendar." },
  { title: "Desktop sign-in, no tokens", body: "Anchor Desktop now signs in through your browser and connects itself." },
];

// Shown once to returning members after a redesign/release, with a small
// preview of the new recap screen. Closes on the button, the ×, Escape or
// a click outside. "Seen" is remembered in this browser, and set as soon
// as it opens, so it never shows twice even if they navigate away.
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
      className="enter-fade fixed inset-0 z-50 flex items-center justify-center bg-brand/40 px-4 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-[0_30px_80px_-20px_rgba(11,25,48,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-lg text-slate-500 hover:bg-white hover:text-slate-900"
        >
          ×
        </button>

        {/* Preview: a miniature of the new recap screen. */}
        <div className="bg-canvas px-8 pt-8">
          <div className="overflow-hidden rounded-t-xl border border-b-0 border-slate-200 bg-white shadow-[0_12px_30px_-14px_rgba(18,41,74,0.35)]">
            <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-[#ec6a5e]" />
              <span className="h-2 w-2 rounded-full bg-[#f4bf4f]" />
              <span className="h-2 w-2 rounded-full bg-[#61c554]" />
              <span className="flex items-center gap-1.5 pl-3 font-semibold text-[12px] text-slate-700">
                <AnchorMark size={13} /> Anchor
              </span>
            </div>
            <div className="px-4 pb-4 pt-3">
              <p className="eyebrow !text-[9px]">Recap · ready after the call</p>
              <p className="mt-1 font-semibold text-[17px] text-slate-900">Investor sync — Northbridge</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  ["3", "Key points", "text-slate-900"],
                  ["2", "Action items", "text-slate-900"],
                  ["1", "Open risk", "text-accent"],
                ].map(([n, label, tone]) => (
                  <div key={label} className="rounded-lg border border-slate-200 px-2.5 py-2">
                    <p className={`font-semibold text-xl leading-none ${tone}`}>{n}</p>
                    <p className="mt-1 text-[10px] text-slate-500">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-2">
                <span className="font-semibold text-[13px] text-slate-900">Follow-up email</span>
                <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium text-white">
                  Save to Gmail drafts
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-8 pb-7 pt-6">
          <p className="eyebrow">What&apos;s new</p>
          <h2 id="whats-new-title" className="mt-2 text-3xl leading-tight text-brand">
            Welcome back to the new Anchor
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {HIGHLIGHTS.map((h) => (
              <li key={h.title} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <p className="text-sm leading-relaxed text-slate-600">
                  <span className="font-medium text-slate-900">{h.title}.</span> {h.body}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-accent-dark"
            >
              Take a look
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
