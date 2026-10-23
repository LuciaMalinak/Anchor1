"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status = {
  specialty: { sectorName: string; companyName: string; generatedAt: string; tools: unknown[] } | null;
  status: "building" | "ready" | "failed" | null;
  companyWebsite: string | null;
  isOwner: boolean;
};

// How long after it's built Home keeps announcing the team's own Anchor.
const ANNOUNCE_DAYS = 14;

// Home's card for the team's own specialty (specialtyAuto.ts): asks the
// owner for the company website when Anchor has nothing to go on, shows
// progress while it builds in the background, then links to
// "Anchor for <Company>" once it's ready.
export function SpecialtyHomeCard() {
  const [s, setS] = useState<Status | null>(null);
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const building = s?.status === "building";

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () =>
      fetch("/api/team/specialty")
        .then((r) => (r.ok ? r.json() : null))
        .then((body: Status | null) => {
          if (!body || stopped) return;
          setS(body);
          if (body.status === "building") timer = setTimeout(check, 5000);
        })
        .catch(() => {});
    void check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [building]);

  async function start() {
    setSending(true);
    setError(null);
    const res = await fetch("/api/team/specialty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ website }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setSending(false);
    if (!res?.ok) {
      setError(body.error || "Couldn't start. Try again.");
      return;
    }
    setS((prev) => (prev ? { ...prev, status: "building", companyWebsite: website } : prev));
  }

  if (!s) return null;

  if (s.specialty && !building) {
    const fresh = Date.now() - Date.parse(s.specialty.generatedAt) < ANNOUNCE_DAYS * 86_400_000;
    if (!fresh) return null;
    return (
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent/30 bg-accent/5 px-6 py-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">Your Anchor is ready</p>
          <h2 className="mt-1 text-base font-semibold text-brand">Built for {s.specialty.sectorName}</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Your calls are now coached the way an expert in your exact business would, and {s.specialty.tools.length} tools made for{" "}
            {s.specialty.companyName} are on every deal.
          </p>
        </div>
        <Link href="/dashboard/specialty" className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-dark">
          See your Anchor
        </Link>
      </section>
    );
  }

  if (building) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <p className="flex items-center gap-2 text-sm font-medium text-brand">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
          Building your Anchor{s.companyWebsite ? ` for ${s.companyWebsite.replace(/^https?:\/\//, "")}` : ""}…
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Anchor is researching your company and designing a playbook and expert tools for exactly what you do. About a minute.
        </p>
      </section>
    );
  }

  if (!s.isOwner) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <h2 className="text-base font-semibold text-brand">
        {s.status === "failed" ? "Let's try building your Anchor again" : "Make Anchor an expert in your business"}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Add your company&apos;s website. Anchor researches what you do and builds a playbook and expert tools for your exact niche, so it can
        coach your calls, write your documents and stand in for you in meetings.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="yourcompany.com"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
        />
        <button
          type="button"
          onClick={start}
          disabled={sending || !website.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-dark disabled:opacity-50"
        >
          {sending ? "Starting…" : "Build my Anchor"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
