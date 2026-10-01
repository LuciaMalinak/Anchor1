"use client";

import { useEffect, useRef, useState } from "react";
import { stashPendingGoogleAction, takePendingGoogleAction } from "@/lib/pendingGoogleAction";

type Snapshot = {
  provider: "salesforce" | "hubspot";
  recordName: string | null;
  recordUrl: string | null;
  stage: string | null;
  stageOptions: { value: string; label: string }[];
  closeDate: string | null;
  amount: number | null;
  nextStep: string | null;
};
type Suggestion<T> = { value: T; reason: string } | null;
type Proposal = {
  stage: Suggestion<string>;
  closeDate: Suggestion<string>;
  amount: Suggestion<number>;
  nextStep: Suggestion<string>;
};
type FieldKey = "stage" | "closeDate" | "amount" | "nextStep";
type Changes = Partial<{ stage: string; closeDate: string; amount: number; nextStep: string }>;

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "stage", label: "Stage" },
  { key: "closeDate", label: "Close date" },
  { key: "amount", label: "Amount" },
  { key: "nextStep", label: "Next step" },
];

// "Update Salesforce / HubSpot" on a meeting recap: Anchor reads the
// linked record, suggests which of four fields this call changed (with
// the reason), and writes only the ones the user ticks and approves.
export function CrmUpdateCard({ meetingId, crmName }: { meetingId: string; crmName: string }) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [values, setValues] = useState<Record<FieldKey, string>>({ stage: "", closeDate: "", amount: "", nextStep: "" });
  const [selected, setSelected] = useState<Record<FieldKey, boolean>>({ stage: false, closeDate: false, amount: false, nextStep: false });
  const [done, setDone] = useState<string | null>(null);

  // Back from granting HubSpot write permission: finish the update.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = takePendingGoogleAction<Changes>("crm", meetingId);
    if (pending) queueMicrotask(() => void apply(pending, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  async function suggest() {
    setLoading(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/crm-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "propose" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't suggest updates");
      const s: Snapshot = body.snapshot;
      const p: Proposal = body.proposal;
      setSnapshot(s);
      setProposal(p);
      setValues({
        stage: p.stage?.value ?? s.stage ?? "",
        closeDate: p.closeDate?.value ?? s.closeDate ?? "",
        amount: String(p.amount?.value ?? s.amount ?? ""),
        nextStep: p.nextStep?.value ?? s.nextStep ?? "",
      });
      setSelected({ stage: Boolean(p.stage), closeDate: Boolean(p.closeDate), amount: Boolean(p.amount), nextStep: Boolean(p.nextStep) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't suggest updates");
    } finally {
      setLoading(false);
    }
  }

  function changesFromForm(): Changes | string {
    const c: Changes = {};
    if (selected.stage) c.stage = values.stage;
    if (selected.closeDate) c.closeDate = values.closeDate;
    if (selected.amount) {
      const n = Number(values.amount.replace(/[,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) return "Amount must be a number.";
      c.amount = n;
    }
    if (selected.nextStep) c.nextStep = values.nextStep;
    return Object.keys(c).length ? c : "Tick at least one field to update.";
  }

  async function apply(changes: Changes, afterPermission = false) {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/crm-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", changes }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && body.connectUrl) {
        if (afterPermission) throw new Error(`Anchor needs permission to update deals in ${crmName}. Try again and allow it.`);
        stashPendingGoogleAction("crm", meetingId, changes);
        window.location.href = body.connectUrl;
        return;
      }
      if (!res.ok) throw new Error(body.error || `Couldn't update ${crmName}`);
      setSnapshot(body.snapshot);
      setProposal(null);
      setDone(`Updated ${body.applied.length} field${body.applied.length === 1 ? "" : "s"} in ${crmName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Couldn't update ${crmName}`);
    } finally {
      setApplying(false);
    }
  }

  function current(key: FieldKey): string {
    if (!snapshot) return "";
    if (key === "stage") return snapshot.stageOptions.find((o) => o.value === snapshot.stage)?.label ?? snapshot.stage ?? "—";
    if (key === "amount") return snapshot.amount != null ? snapshot.amount.toLocaleString() : "—";
    return (snapshot[key] as string | null) || "—";
  }

  const nothingSuggested = proposal && !proposal.stage && !proposal.closeDate && !proposal.amount && !proposal.nextStep;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-slate-900">Update {crmName}</h2>
          <p className="mt-1 text-xs text-slate-500">
            Anchor suggests the deal fields this call changed. Nothing is written to {crmName} until you approve it.
          </p>
        </div>
        <button
          type="button"
          onClick={suggest}
          disabled={loading || applying}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-dark disabled:opacity-50"
        >
          {loading ? "Reading the call…" : proposal ? "Suggest again" : "Suggest updates"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {done && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {done}{" "}
          {snapshot?.recordUrl && (
            <a href={snapshot.recordUrl} target="_blank" rel="noreferrer" className="font-medium underline">
              Open in {crmName} ↗
            </a>
          )}
        </p>
      )}
      {proposal && snapshot && (
        <div className="mt-4 flex flex-col gap-3">
          {snapshot.recordName && <p className="text-xs text-slate-500">Record: {snapshot.recordName}</p>}
          {nothingSuggested && <p className="text-sm text-slate-500">This call doesn&apos;t clearly change any fields. You can still edit and tick them below.</p>}
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {FIELDS.map(({ key, label }) => {
              const reason = proposal[key]?.reason;
              const inputId = `crm-${key}-${meetingId}`;
              return (
                <div key={key} className="grid gap-2 px-4 py-3 sm:grid-cols-[auto_8rem_minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center">
                  <input
                    type="checkbox"
                    aria-label={`Update ${label}`}
                    checked={selected[key]}
                    onChange={(e) => setSelected((s) => ({ ...s, [key]: e.target.checked }))}
                    className="h-4 w-4"
                  />
                  <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
                    {label}
                  </label>
                  <span className="truncate text-sm text-slate-400" title={current(key)}>
                    Now: {current(key)}
                  </span>
                  <div>
                    {key === "stage" ? (
                      <select
                        id={inputId}
                        value={values.stage}
                        onChange={(e) => {
                          setValues((v) => ({ ...v, stage: e.target.value }));
                          setSelected((s) => ({ ...s, stage: true }));
                        }}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      >
                        {snapshot.stageOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={inputId}
                        type={key === "closeDate" ? "date" : "text"}
                        inputMode={key === "amount" ? "decimal" : undefined}
                        maxLength={key === "nextStep" ? 255 : undefined}
                        value={values[key]}
                        onChange={(e) => {
                          const value = e.target.value;
                          setValues((v) => ({ ...v, [key]: value }));
                          setSelected((s) => ({ ...s, [key]: true }));
                        }}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    )}
                    {reason && <p className="mt-1 text-xs italic text-slate-500">{reason}</p>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={applying}
              onClick={() => {
                const changes = changesFromForm();
                if (typeof changes === "string") {
                  setError(changes);
                  return;
                }
                void apply(changes);
              }}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
            >
              {applying ? "Updating…" : `Update ${crmName}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
