"use client";

// A tabbed product mockup for the landing page — Before / During / After —
// styled to match the deck's own product slides exactly (navy header bars,
// copper labels, confidence badges). Content is illustrative, generic
// example data, not real meeting content.
import { useState } from "react";

type Tab = "before" | "during" | "after";

const TABS: { key: Tab; label: string }[] = [
  { key: "before", label: "Before" },
  { key: "during", label: "During" },
  { key: "after", label: "After" },
];

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex gap-2">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`rounded-md px-4 py-1.5 text-xs font-semibold tracking-[0.15em] transition ${
            active === t.key
              ? "bg-brand text-white"
              : "border border-slate-300 text-slate-500 hover:border-slate-400"
          }`}
        >
          {t.label.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold tracking-[0.15em] text-accent">{children}</p>
  );
}

function BeforePanel() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="rounded-lg border border-slate-200">
        <div className="flex items-center justify-between rounded-t-lg bg-brand px-5 py-3 text-white">
          <span className="text-sm font-semibold">
            RUN SHEET — Acme Renewal, Thu 2:00pm
          </span>
          <span className="hidden text-[11px] tracking-wide text-slate-300 sm:inline">
            BUILT FROM 6 PRIOR MEETINGS
          </span>
        </div>
        <div className="space-y-5 px-5 py-5">
          <div>
            <Eyebrow>OPENING FRAME</Eyebrow>
            <p className="mt-2 rounded-md bg-slate-100 px-4 py-3 text-sm italic text-slate-700">
              &ldquo;We&rsquo;re here to confirm the renewal date, not reopen pricing.&rdquo;
            </p>
          </div>
          <div>
            <Eyebrow>POSITION BANK</Eyebrow>
            <div className="mt-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">If they push on price:</p>
                <p className="text-sm text-slate-600">Hold current tier — confirmed last QBR.</p>
              </div>
              <span className="shrink-0 rounded bg-emerald-700 px-2 py-0.5 text-[10px] font-semibold text-white">
                HIGH CONF.
              </span>
            </div>
          </div>
          <div>
            <Eyebrow>WHAT WE ALREADY SETTLED</Eyebrow>
            <p className="mt-2 text-sm text-slate-600">
              Onboarding timeline agreed May 3. Don&rsquo;t reopen it.
            </p>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 px-5 py-5">
        <Eyebrow>WHO IS IN THE ROOM</Eyebrow>
        <div className="mt-2 space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Dana Whitfield — VP Ops, Acme</p>
            <p className="text-xs text-slate-500">3rd meeting · Direct, numbers-first · Raised price in June</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Marcus Lee — Procurement, Acme</p>
            <p className="text-xs text-slate-500">First meeting · Warm intro · Hasn&rsquo;t seen the pricing debate</p>
          </div>
        </div>
        <div className="mt-5">
          <Eyebrow>ANTICIPATED QUESTIONS</Eyebrow>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>Why did usage drop in Q2?</li>
            <li>Who owns the integration work?</li>
          </ul>
        </div>
        <div className="mt-5 rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
          <p className="text-sm text-slate-700">
            <span className="font-semibold text-accent">Escalate if:</span> contract term or
            discount beyond 10%. Anchor pings you live.
          </p>
        </div>
      </div>
    </div>
  );
}

function DuringPanel() {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 rounded-t-lg bg-brand px-5 py-3 text-white">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-sm font-semibold">LIVE ASSIST — Acme Renewal, in progress</span>
      </div>
      <div className="space-y-5 px-5 py-5">
        <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">
          <span className="font-semibold text-slate-900">Marcus typed:</span> &ldquo;they&rsquo;re
          asking about the discount again&rdquo;
        </p>
        <div>
          <Eyebrow>SUGGESTED RESPONSE</Eyebrow>
          <p className="mt-2 rounded-md border border-brand/30 bg-brand/5 px-4 py-3 text-sm font-medium text-slate-800">
            &ldquo;We held this tier with the last two renewals. Dana raised it in June too — this
            is consistent, not new.&rdquo;
          </p>
        </div>
        <div>
          <Eyebrow>GROUNDED IN</Eyebrow>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>QBR notes, June 2 — tier held</li>
            <li>Renewal call, last cycle — same objection raised</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function AfterPanel() {
  const [sent, setSent] = useState(false);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-lg border border-slate-200">
        <div className="rounded-t-lg bg-brand px-5 py-3 text-white">
          <span className="text-sm font-semibold">
            ACME RENEWAL — RECAP — sent 4 minutes after the call ended
          </span>
        </div>
        <div className="space-y-5 px-5 py-5">
          <div>
            <Eyebrow>DECISIONS</Eyebrow>
            <p className="mt-2 text-sm font-medium text-slate-900">Renewal confirmed for Mar 14</p>
            <p className="text-xs text-slate-500">Owner: Marcus</p>
          </div>
          <div>
            <Eyebrow>ACTION ITEMS</Eyebrow>
            <div className="mt-2 divide-y divide-slate-100 text-sm">
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-700">Send updated usage report</span>
                <span className="text-slate-500">Marcus</span>
                <span className="font-semibold text-accent">Thu</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-700">Circulate signed order form</span>
                <span className="text-slate-500">Dana</span>
                <span className="font-semibold text-accent">Fri</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-slate-200 px-5 py-5">
          <Eyebrow>SHARE THIS RECAP</Eyebrow>
          <p className="mt-2 text-sm text-slate-600">
            Send the decisions and action items to everyone who needs them — not just the people
            who were in the room.
          </p>
          <div className="mt-4 flex -space-x-2">
            {["D", "M", "P", "J"].map((initial) => (
              <span
                key={initial}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-brand text-[11px] font-semibold text-white"
              >
                {initial}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSent(true)}
            disabled={sent}
            className="mt-4 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark disabled:bg-emerald-700"
          >
            {sent ? "Sent to team ✓" : "Send summary to team"}
          </button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-5">
          <p className="text-sm font-semibold text-slate-900">The loop closes here</p>
          <p className="mt-2 text-sm text-slate-600">
            Nothing here is filed and forgotten — every decision becomes an input to the next
            brief, for you or for whoever goes in your place next time.
          </p>
        </div>
      </div>
    </div>
  );
}

export function ProductShowcase() {
  const [tab, setTab] = useState<Tab>("before");

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Eyebrow>II.&nbsp;&nbsp;PRODUCT</Eyebrow>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            The same meeting, the same context — before, during, and after
          </h2>
        </div>
        <TabBar active={tab} onChange={setTab} />
      </div>
      <div className="mt-8">
        {tab === "before" && <BeforePanel />}
        {tab === "during" && <DuringPanel />}
        {tab === "after" && <AfterPanel />}
      </div>
    </div>
  );
}
