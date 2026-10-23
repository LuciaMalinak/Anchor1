"use client";

import { useEffect, useState } from "react";

type Status = {
  specialty: { sectorName: string; companyName: string; generatedAt: string; tools: unknown[] } | null;
  status: "building" | "ready" | "failed" | null;
  companyWebsite: string | null;
  isOwner: boolean;
};


// Home's card for the team's own specialty (specialtyAuto.ts): asks the
// owner for the company website, only while Anchor has nothing to go on.
// After that, it's built in the background, and the Profile page's
// company box is where more context goes.
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
  // Once a website is in (or it's built or building), this leaves Home;
  // more context goes in the Profile page's company box.
  if (!s.isOwner || s.specialty || s.companyWebsite || building) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <h2 className="text-base font-semibold text-brand">
        Make Anchor an expert in your business
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
