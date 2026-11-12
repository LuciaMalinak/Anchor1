"use client";

import { useCallback, useEffect, useState } from "react";

type Code = {
  code: string;
  trialDays: number;
  maxUses: number | null;
  uses: number;
  active: boolean;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
};
type Lead = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  teamSize: string | null;
  message: string | null;
  status: string;
  createdAt: string;
};
type TeamRow = {
  id: string;
  name: string;
  ownerEmail: string | null;
  billingExempt: boolean;
  billingStatus: string | null;
  billingPlan: string | null;
  billingSeats: number | null;
  trialEndsAt: string | null;
  promoCodeUsed: string | null;
  hasSubscription: boolean;
  currentPeriodEnd: string | null;
  billingCancelAt: string | null;
  billingPausedAt: string | null;
  billingResumesAt: string | null;
  createdAt: string;
};
type Data = { configured: boolean; codes: Code[]; leads: Lead[]; teams: TeamRow[] };

const card = "rounded-xl border border-slate-200 bg-white p-5";
const btn = "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const input = "rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none";

function date(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

function status(t: TeamRow): { label: string; tone: string } {
  const open = ["active", "trialing", "past_due"].includes(t.billingStatus ?? "");
  if (open && t.billingPausedAt) return { label: `Paused${t.billingResumesAt ? ` until ${date(t.billingResumesAt)}` : ""} · ${t.billingPlan === "pro" ? "Pro" : "Team"}`, tone: "text-amber-700" };
  if (open && t.billingCancelAt) return { label: `Cancelled · ends ${date(t.billingCancelAt)}`, tone: "text-amber-700" };
  if (t.billingStatus === "active") return { label: `Paying · ${t.billingPlan === "pro" ? "Pro" : "Team"} · ${t.billingSeats ?? 1} seat(s)`, tone: "text-emerald-700" };
  if (t.billingStatus === "trialing") return { label: `Free trial until ${date(t.trialEndsAt)}${t.promoCodeUsed ? ` (${t.promoCodeUsed})` : ""}`, tone: "text-sky-700" };
  if (t.billingStatus === "past_due") return { label: "Payment failed (Stripe retrying)", tone: "text-amber-700" };
  if (t.billingExempt) return { label: "Free access", tone: "text-slate-600" };
  if (t.billingStatus) return { label: `Not paying (${t.billingStatus})`, tone: "text-red-600" };
  return { label: "Not subscribed", tone: "text-red-600" };
}

// What the owner can do to a client's subscription, with the question
// asked before doing it.
function subscriptionChanges(t: TeamRow): { label: string; change: Record<string, unknown>; confirm: string }[] {
  if (!t.hasSubscription || !["active", "trialing", "past_due"].includes(t.billingStatus ?? "")) return [];
  const other = t.billingPlan === "pro" ? "team" : "pro";
  const name = t.name;
  const out: { label: string; change: Record<string, unknown>; confirm: string }[] = [
    {
      label: other === "pro" ? "Upgrade to Pro" : "Switch to Team",
      change: { action: "change-plan", plan: other },
      confirm: `Move ${name} to ${other === "pro" ? "Pro" : "Team"}? Stripe charges or credits the difference on their next bill.`,
    },
  ];
  if (t.billingPausedAt) out.push({ label: "Resume billing", change: { action: "resume" }, confirm: `Resume ${name}'s subscription now? Billing restarts and they get back in.` });
  else {
    out.push({ label: "Pause 1 month", change: { action: "pause", months: 1 }, confirm: `Pause ${name}'s billing for a month? Nothing is charged and they're locked out until it resumes; their data is kept.` });
    out.push({ label: "Pause until resumed", change: { action: "pause", months: null }, confirm: `Pause ${name}'s billing until you resume it? Nothing is charged and they're locked out; their data is kept.` });
  }
  if (t.billingCancelAt) out.push({ label: "Undo cancellation", change: { action: "keep" }, confirm: `Keep ${name}'s subscription? It renews as usual.` });
  else out.push({ label: "Cancel at period end", change: { action: "cancel" }, confirm: `Cancel ${name}'s subscription at the end of the paid period? They keep access until then.` });
  out.push({ label: "Cancel now", change: { action: "cancel-now" }, confirm: `Cancel ${name}'s subscription right now? They lose access straight away (unless marked Free). Their data is kept. This can't be undone; they'd have to subscribe again.` });
  return out;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/billing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const json = await res?.json().catch(() => null);
  return { ok: Boolean(res?.ok), error: json?.error as string | undefined };
}

export function AdminBillingClient() {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState({ code: "", trialDays: "7", maxUses: "1", note: "", expiresAt: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState("");
  const [busyTeam, setBusyTeam] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/billing").catch(() => null);
    if (res?.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    async function load() {
      await refresh();
    }
    void load();
  }, [refresh]);

  async function createCode(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await post({ action: "createPromo", ...form });
    if (r.ok) {
      setMsg({ ok: true, text: `Created ${form.code.toUpperCase()}. Send it to your client: they enter it on the payment page.` });
      setForm({ ...form, code: "", note: "" });
    } else setMsg({ ok: false, text: r.error ?? "Couldn't create the code." });
    await refresh();
  }

  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const teams = data.teams.filter(
    (t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || (t.ownerEmail ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  const newLeads = data.leads.filter((l) => l.status === "new");

  return (
    <div className="flex flex-col gap-8">
      {!data.configured && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Stripe isn&apos;t connected yet: add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Render. Until then new sign-ups
          see the plans page with &ldquo;Contact sales&rdquo; only.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">Promo codes</h2>
        <form onSubmit={createCode} className={`${card} flex flex-col gap-3`}>
          <p className="text-xs text-slate-500">
            A code gives a free trial: the client enters their card, uses Anchor.AI free for the days you choose, and is billed
            after unless they cancel. Use one code per client (max uses 1) so each one stays theirs.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Code
              <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="ACMEWEEK" className={`${input} w-44 uppercase`} />
            </label>
            <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Free for
              <div className="flex gap-1">
                {["7", "14"].map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setForm({ ...form, trialDays: d })}
                    className={`rounded-lg border px-3 py-2 text-sm ${form.trialDays === d ? "border-brand bg-brand text-white" : "border-slate-200 text-slate-700"}`}
                  >
                    {d === "7" ? "1 week" : "2 weeks"}
                  </button>
                ))}
                <input
                  value={form.trialDays}
                  onChange={(e) => setForm({ ...form, trialDays: e.target.value.replace(/\D/g, "") })}
                  className={`${input} w-16`}
                  aria-label="Free days"
                />
                <span className="self-center text-xs text-slate-500">days</span>
              </div>
            </div>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Max uses
              <input value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/\D/g, "") })} placeholder="∞" className={`${input} w-20`} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Expires (optional)
              <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={input} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
              Who it&apos;s for
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Jane at Acme Capital" className={input} />
            </label>
            <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              Create code
            </button>
          </div>
          {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
        </form>
        {data.codes.length > 0 && (
          <div className={`${card} overflow-x-auto p-0`}>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Code</th>
                  <th className="px-4 py-2">Free</th>
                  <th className="px-4 py-2">Used</th>
                  <th className="px-4 py-2">For</th>
                  <th className="px-4 py-2">Expires</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.codes.map((c) => (
                  <tr key={c.code} className={`border-t border-slate-100 ${c.active ? "" : "opacity-50"}`}>
                    <td className="px-4 py-2 font-mono font-medium">{c.code}</td>
                    <td className="px-4 py-2">{c.trialDays} days</td>
                    <td className="px-4 py-2">
                      {c.uses}
                      {c.maxUses !== null ? ` / ${c.maxUses}` : ""}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{c.note}</td>
                    <td className="px-4 py-2 text-slate-600">{date(c.expiresAt) || "Never"}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={async () => {
                          await post({ action: "setPromoActive", code: c.code, active: !c.active });
                          await refresh();
                        }}
                        className={btn}
                      >
                        {c.active ? "Turn off" : "Turn on"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">Sales requests{newLeads.length ? ` (${newLeads.length} new)` : ""}</h2>
        {data.leads.length === 0 && <p className={`${card} text-sm text-slate-500`}>None yet.</p>}
        {data.leads.map((l) => (
          <div key={l.id} className={`${card} flex flex-col gap-1 ${l.status === "done" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">
                {l.name}
                {l.company ? ` · ${l.company}` : ""}
                {l.teamSize ? ` · ${l.teamSize} people` : ""}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{date(l.createdAt)}</span>
                <a href={`mailto:${l.email}`} className={btn}>
                  Reply
                </a>
                <button
                  onClick={async () => {
                    await post({ action: "setLeadStatus", leadId: l.id, status: l.status === "done" ? "new" : "done" });
                    await refresh();
                  }}
                  className={btn}
                >
                  {l.status === "done" ? "Reopen" : "Mark done"}
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500">{l.email}</p>
            {l.message && <p className="whitespace-pre-wrap text-sm text-slate-700">{l.message}</p>}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Accounts</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team or email" className={`${input} w-64`} />
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
        <div className={`${card} overflow-x-auto p-0`}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Team</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">Billing</th>
                <th className="px-4 py-2">Free access</th>
                <th className="px-4 py-2">Subscription</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => {
                const st = status(t);
                return (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-900">{t.name}</td>
                    <td className="px-4 py-2 text-slate-600">{t.ownerEmail}</td>
                    <td className={`px-4 py-2 ${st.tone}`}>{st.label}</td>
                    <td className="px-4 py-2">
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={t.billingExempt}
                          onChange={async (e) => {
                            await post({ action: "setTeamExempt", teamId: t.id, exempt: e.target.checked });
                            await refresh();
                          }}
                          className="h-4 w-4 accent-[var(--brand)]"
                        />
                        Free
                      </label>
                    </td>
                    <td className="px-4 py-2">
                      {subscriptionChanges(t).length ? (
                        <select
                          value=""
                          disabled={busyTeam === t.id}
                          onChange={async (e) => {
                            const choice = subscriptionChanges(t)[Number(e.target.value)];
                            if (!choice || !window.confirm(choice.confirm)) return;
                            setBusyTeam(t.id);
                            const r = await post({ action: "subscription", teamId: t.id, change: choice.change });
                            setMsg(r.ok ? { ok: true, text: `${t.name}: ${choice.label.toLowerCase()} done.` } : { ok: false, text: r.error ?? "Couldn't change it." });
                            await refresh();
                            setBusyTeam(null);
                          }}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700"
                        >
                          <option value="">{busyTeam === t.id ? "Working…" : "Change…"}</option>
                          {subscriptionChanges(t).map((c, i) => (
                            <option key={c.label} value={i}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          Every account that existed before payments started is marked Free. Untick to ask them to pay; tick to give anyone
          Anchor.AI for free.
        </p>
      </section>
    </div>
  );
}
