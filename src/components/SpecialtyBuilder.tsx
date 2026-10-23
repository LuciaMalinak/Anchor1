"use client";

import { useEffect, useState } from "react";
import { TOOL_KIND_LABEL } from "@/lib/industryTools";
import type { TeamSpecialty } from "@/lib/teamSpecialty";

// Builds and shows a team's own specialty (teamSpecialty.ts): Anchor
// researches the company's website and writes the playbook it coaches
// their calls with, plus expert tools made for exactly what they do.
// Used on the Team page (endpoint /api/team/specialty, owner only) and by
// Anchor's admin on a client's team page.
export function SpecialtyBuilder({
  endpoint,
  initial,
  canEdit,
  forTeamName,
}: {
  endpoint: string;
  // Leave out to load it from endpoint.
  initial?: TeamSpecialty | null;
  canEdit?: boolean;
  forTeamName?: string;
}) {
  const [specialty, setSpecialty] = useState<TeamSpecialty | null>(initial ?? null);
  const [editable, setEditable] = useState(Boolean(canEdit));
  const [loaded, setLoaded] = useState(initial !== undefined);
  const [editing, setEditing] = useState(false);
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [description, setDescription] = useState("");
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial !== undefined) return;
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body) return;
        setSpecialty(body.specialty ?? null);
        setWebsite(body.specialty?.website ?? "");
        if (typeof body.isOwner === "boolean") setEditable(body.isOwner);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [endpoint, initial]);

  async function build() {
    setBuilding(true);
    setError(null);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ website, description }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBuilding(false);
    if (!res?.ok) {
      setError(body.error || "Couldn't build it. Try again.");
      return;
    }
    setSpecialty(body.specialty);
    setEditing(false);
  }

  async function remove() {
    if (!confirm("Remove this specialty? Its tools disappear from deals (reports already written stay).")) return;
    const res = await fetch(endpoint, { method: "DELETE" }).catch(() => null);
    if (res?.ok) setSpecialty(null);
  }

  if (!loaded) return null;
  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800";
  const showForm = editable && (!specialty || editing);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-medium text-slate-900">Specialty{forTeamName ? ` · ${forTeamName}` : ""}</h2>
      <p className="mt-1 text-sm text-slate-500">
        Anchor researches the company and builds an expert playbook and tools for exactly what it does, not just the broad industry. Calls are
        coached with it, and its tools appear first on every deal.
      </p>

      {specialty && !editing && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">{specialty.sectorName}</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{specialty.companyName}</p>
            <p className="mt-1 text-sm text-slate-600">{specialty.summary}</p>
            {specialty.website && (
              <a href={specialty.website} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand underline">
                {specialty.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Coached as</p>
            <p className="mt-1 text-sm text-slate-700">{specialty.playbook.persona}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {specialty.playbook.checklist.map((c) => (
                <span key={c} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                  {c}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tools made for them ({specialty.tools.length})</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {specialty.tools.map((t) => (
                <li key={t.id} className="rounded-lg border border-slate-200 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{TOOL_KIND_LABEL[t.kind]}</p>
                  <p className="text-sm font-medium text-slate-900">{t.name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{t.outcome}</p>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-slate-400">Built {new Date(specialty.generatedAt).toLocaleDateString()}</p>
          {editable && (
            <div className="flex gap-3">
              <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium text-brand hover:underline">
                Rebuild
              </button>
              <button type="button" onClick={remove} className="text-sm font-medium text-red-600 hover:underline">
                Remove
              </button>
            </div>
          )}
        </div>
      )}

      {!specialty && !editable && <p className="mt-3 text-sm text-slate-500">Not set up yet. The team owner can build it.</p>}

      {showForm && (
        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs font-medium text-slate-700">
            Company website
            <input className={`${input} mt-1`} placeholder="example.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
          <label className="text-xs font-medium text-slate-700">
            What they do (optional, but it sharpens the tools)
            <textarea
              className={`${input} mt-1 min-h-[80px]`}
              placeholder="e.g. Asset management for owners of ultra-luxury hotels: operator oversight, budgets, CapEx, brand and management agreements"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={build}
              disabled={building || (!website.trim() && !description.trim())}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-dark disabled:opacity-50"
            >
              {building ? "Researching and building…" : specialty ? "Rebuild specialty" : "Build specialty"}
            </button>
            {editing && !building && (
              <button type="button" onClick={() => setEditing(false)} className="text-sm text-slate-500 hover:text-slate-700">
                Cancel
              </button>
            )}
            {building && <span className="text-xs text-slate-500">Reading the website and designing the tools. This takes about a minute.</span>}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </section>
  );
}
