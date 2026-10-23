"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status = {
  specialty: { sectorName: string; companyName: string; generatedAt: string } | null;
  status: "building" | "ready" | "failed" | null;
  companyWebsite: string | null;
  companyContext: string | null;
  isOwner: boolean;
};

// "Your Anchor" on the Profile page, for the team's leaders only (the API
// answers 403 for everyone else, and this then shows nothing): what
// Anchor knows the company as, a link to the full Your Anchor page, and a
// place to give it more context (clients, deal types, how you work),
// which rebuilds the team's Anchor with it in the background
// (specialtyAuto.ts).
export function CompanyContextBox() {
  const [s, setS] = useState<Status | null>(null);
  const [context, setContext] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
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
          setContext((c) => c || body.companyContext || "");
          setWebsite((w) => w || body.companyWebsite || "");
          if (body.status === "building") timer = setTimeout(check, 5000);
        })
        .catch(() => {});
    void check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [building]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/team/specialty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: context, ...(website.trim() ? { website } : {}) }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (!res?.ok) {
      setError(body.error || "Couldn't save. Try again.");
      return;
    }
    setJustSaved(true);
    setS((prev) => (prev ? { ...prev, status: "building", companyContext: context } : prev));
  }

  if (!s) return null;
  const name = s.specialty?.companyName;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-brand">Your Anchor</h2>
        {s.specialty && (
          <Link href="/dashboard/specialty" className="text-xs font-medium text-brand hover:underline">
            Open your Anchor →
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {s.specialty ? (
          <>
            Anchor knows {name} as <span className="font-medium text-slate-700">{s.specialty.sectorName.toLowerCase()}</span>
            {s.companyWebsite ? ` (${s.companyWebsite.replace(/^https?:\/\//, "")})` : ""}.
          </>
        ) : building ? null : (
          "Tell Anchor about your company so it can coach your calls and stand in for you like an expert in your business."
        )}
      </p>

      {building && (
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
          {justSaved ? "Updating your Anchor with this" : "Building your Anchor"}. About a minute.
        </p>
      )}
      {s.status === "failed" && !building && <p className="mt-2 text-sm text-red-600">The last build didn&apos;t finish. Save again to retry.</p>}

      {s.isOwner ? (
        <div className="mt-3 flex flex-col gap-2">
          {!s.companyWebsite && !s.specialty && (
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="Company website (e.g. yourcompany.com)"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
            />
          )}
          <label className="text-xs font-medium text-slate-700">
            Give Anchor more context about your company
            <textarea
              value={context}
              onChange={(e) => {
                setContext(e.target.value);
                setJustSaved(false);
              }}
              placeholder="Who your clients are, the deals and meetings you run, what makes you different, words you use, who usually leads and who steps in…"
              className="mt-1 min-h-[96px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving || building || (!context.trim() && !website.trim() && !s.companyWebsite)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-dark disabled:opacity-50"
            >
              {saving ? "Saving…" : s.specialty ? "Update my Anchor" : "Build my Anchor"}
            </button>
            <span className="text-xs text-slate-400">Rebuilds your playbook and tools with this. Reports already written stay.</span>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400">Your team owner can add more context here.</p>
      )}
    </section>
  );
}
