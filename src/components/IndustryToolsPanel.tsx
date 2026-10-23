"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAskAnchor } from "@/components/AskAnchorDock";
import {
  TOOL_KIND_LABEL,
  toolReportMarkdown,
  type SavedToolReport,
  type ToolKind,
  type ToolPhase,
  type ToolReport,
} from "@/lib/industryTools";

type ToolInfo = { id: string; name: string; outcome: string; phase: ToolPhase; kind: ToolKind; clientFacing: boolean; all: boolean };
type ToolsResponse = {
  industry: string | null;
  tools: ToolInfo[];
  reports: Record<string, SavedToolReport>;
  hasContactEmail: boolean;
};

const KIND_ORDER: ToolKind[] = ["prep", "intel", "negotiate", "document", "track", "compliance"];

// One fetch per deal page, shared by the Before and After tab panels.
const loads = new Map<string, Promise<ToolsResponse>>();
function loadTools(dealId: string): Promise<ToolsResponse> {
  let p = loads.get(dealId);
  if (!p) {
    p = fetch(`/api/deals/${dealId}/industry-tools`).then(async (res) => {
      if (!res.ok) throw new Error("Couldn't load the tools");
      return res.json();
    });
    p.catch(() => loads.delete(dealId));
    loads.set(dealId, p);
  }
  return p;
}

function csv(table: { columns: string[]; rows: string[][] }): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [table.columns, ...table.rows].map((r) => r.map((c) => q(c ?? "")).join(",")).join("\n");
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "report";
}

function ReportView({ report }: { report: ToolReport }) {
  return (
    <div className="flex min-w-0 flex-col gap-5 text-sm text-slate-700">
      {report.summary && <p className="text-[15px] leading-relaxed text-slate-800">{report.summary}</p>}
      {report.sections.map((s, i) => (
        <div key={i} className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s.heading}</h4>
            {s.table && s.table.rows.length > 0 && (
              <button
                type="button"
                onClick={() => download(`${slug(report.title)}-${slug(s.heading)}.csv`, csv(s.table!), "text/csv")}
                className="text-xs font-medium text-brand hover:underline"
              >
                Download CSV
              </button>
            )}
          </div>
          {s.text && <p className="mt-1.5 whitespace-pre-line leading-relaxed">{s.text}</p>}
          {s.bullets && s.bullets.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              {s.bullets.map((b, j) => (
                <li key={j}>{b}</li>
              ))}
            </ul>
          )}
          {s.table && s.table.columns.length > 0 && (
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-left text-[13px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {s.table.columns.map((c, j) => (
                      <th key={j} className="whitespace-nowrap px-3 py-2 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {s.table.rows.length === 0 ? (
                    <tr>
                      <td colSpan={s.table.columns.length} className="px-3 py-2 text-slate-400">
                        Nothing yet
                      </td>
                    </tr>
                  ) : (
                    s.table.rows.map((row, j) => (
                      <tr key={j} className="align-top">
                        {row.map((cell, k) => (
                          <td key={k} className={`min-w-[7rem] px-3 py-2 ${k === 0 ? "font-medium text-slate-900" : ""}`}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      {report.gaps.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Still missing</p>
          <p className="mt-0.5 text-xs text-amber-800">Anchor will prompt you for these on the next live call.</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-amber-900">
            {report.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// The industry tools on a deal's Before or After tab: expert reports for
// the team's industry (see src/lib/industryTools.ts), grouped by what
// they're for, written from every call on the deal and saved on it. Once
// written, a report updates itself after each new call (autopilot in
// industryToolRun.ts), can go to the client as a Gmail draft, or become a
// deck or spreadsheet through Ask Anchor.
export function IndustryToolsPanel({ dealId, phase }: { dealId: string; phase: ToolPhase }) {
  const [data, setData] = useState<ToolsResponse | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<{ state: "saving" | "saved" | "error"; message?: string; url?: string | null } | null>(null);
  const { ask } = useAskAnchor();

  useEffect(() => {
    loadTools(dealId)
      .then(setData)
      .catch(() => setError("Couldn't load the industry tools."));
  }, [dealId]);

  if (!data) {
    return error ? <p className="text-sm text-red-600">{error}</p> : null;
  }

  const tools = data.tools.filter((t) => t.phase === phase);
  if (!tools.length) return null;
  const open = openId ? tools.find((t) => t.id === openId) ?? null : null;
  const saved = open ? data.reports[open.id] : null;
  const groups = KIND_ORDER.map((kind) => ({ kind, tools: tools.filter((t) => t.kind === kind) })).filter((g) => g.tools.length);

  async function run(toolId: string) {
    setRunning(toolId);
    setOpenId(toolId);
    setError(null);
    setDraft(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/industry-tools/${toolId}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't write the report");
      setData((d) => (d ? { ...d, reports: { ...d.reports, [toolId]: body } } : d));
      // Keep the shared cache in step, so the other tab sees it too.
      loads.set(dealId, Promise.resolve({ ...data!, reports: { ...data!.reports, [toolId]: body } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't write the report");
    } finally {
      setRunning(null);
    }
  }

  async function saveDraft(toolId: string) {
    setDraft({ state: "saving" });
    const res = await fetch(`/api/deals/${dealId}/industry-tools/${toolId}/draft`, { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) {
      setDraft({
        state: "saved",
        url: body.openUrl ?? null,
        message: body.to?.length ? `Saved in Gmail drafts, to ${body.to.join(", ")}.` : "Saved in Gmail drafts. Add who it goes to there.",
      });
    } else {
      setDraft({ state: "error", message: body.error || "Couldn't save the draft.", url: body.connectUrl ?? null });
    }
  }

  const btn = "rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand hover:text-brand";

  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-brand">{phase === "before" ? "Prep tools" : "Reports & tools"}</h2>
        {!data.industry && (
          <Link href="/dashboard/team" className="text-xs font-medium text-brand hover:underline">
            Set your industry for more tools
          </Link>
        )}
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        Written by Anchor from every call, file and email on this deal. Once written, each one updates itself after every new call, and
        what&apos;s missing becomes your checklist on the next one.
      </p>

      {groups.map((g) => (
        <div key={g.kind} className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{TOOL_KIND_LABEL[g.kind]}</h3>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {g.tools.map((t) => {
              const has = Boolean(data.reports[t.id]);
              const active = openId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    if (has) setOpenId(active ? null : t.id);
                    else void run(t.id);
                  }}
                  disabled={running !== null && running !== t.id}
                  className={`rounded-lg border px-4 py-3 text-left transition disabled:opacity-50 ${
                    active ? "border-accent bg-accent/5" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">{t.name}</span>
                    <span className="shrink-0 text-[11px] font-medium text-slate-400">
                      {running === t.id ? "Writing…" : has ? (active ? "Hide" : "View") : "Create"}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{t.outcome}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {open && running === open.id && !saved && (
        <p className="mt-5 text-sm text-slate-500">Reading every call on this deal and writing the {open.name.toLowerCase()}…</p>
      )}

      {open && saved && (
        <div className="mt-5 border-t border-slate-100 pt-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">{saved.report.title}</h3>
              <p className="text-xs text-slate-500">
                Written {new Date(saved.generatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {" · "}updates itself after each call
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {open.clientFacing && (
                <button type="button" onClick={() => saveDraft(open.id)} disabled={draft?.state === "saving"} className={btn}>
                  {draft?.state === "saving" ? "Saving…" : "Save as Gmail draft"}
                </button>
              )}
              <button type="button" onClick={() => ask(`Turn the "${saved.report.title}" report on this deal into a PowerPoint deck.`)} className={btn}>
                Make a deck
              </button>
              <button type="button" onClick={() => ask(`Turn the "${saved.report.title}" report on this deal into an Excel spreadsheet, one sheet per table.`)} className={btn}>
                Make a spreadsheet
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard
                    .writeText(toolReportMarkdown(saved.report))
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                    .catch(() => {});
                }}
                className={btn}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={() => download(`${slug(saved.report.title)}.md`, toolReportMarkdown(saved.report), "text/markdown")} className={btn}>
                Download
              </button>
              <button
                type="button"
                onClick={() => run(open.id)}
                disabled={running !== null}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-dark disabled:opacity-50"
              >
                {running === open.id ? "Writing…" : "Update"}
              </button>
            </div>
          </div>
          {draft && draft.state !== "saving" && (
            <p className={`mb-4 text-sm ${draft.state === "saved" ? "text-emerald-700" : "text-red-600"}`}>
              {draft.message}{" "}
              {draft.url && (
                <a href={draft.url} target={draft.state === "saved" ? "_blank" : undefined} rel="noreferrer" className="font-semibold underline">
                  {draft.state === "saved" ? "Open Gmail drafts" : "Allow it"}
                </a>
              )}
            </p>
          )}
          <ReportView report={saved.report} />
        </div>
      )}
    </section>
  );
}
