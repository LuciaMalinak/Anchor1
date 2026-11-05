"use client";

import { useState } from "react";

type Plan = "team" | "pro";

function price(plan: Plan, seats: number): number {
  return plan === "team" ? 49 * seats : 149 + 59 * Math.max(0, seats - 1);
}

const PLANS: { key: Plan; name: string; unit: string; features: string[]; highlight?: boolean }[] = [
  {
    key: "team",
    name: "Team",
    unit: "$49 per person / month",
    features: ["Meeting recording, transcripts and summaries", "Action tracking and recaps", "Deal and contact tracking"],
  },
  {
    key: "pro",
    name: "Pro",
    unit: "$149 for you + $59 per teammate / month",
    highlight: true,
    features: [
      "Everything in Team",
      "Pre-meeting briefs from your history",
      "Live assist for delegates, in a call or in person",
      "Style profile, position bank and process scoring",
    ],
  },
];

export function BillingPlans({ seats }: { seats: number }) {
  const [promo, setPromo] = useState("");
  const [applied, setApplied] = useState<{ code: string; trialDays: number } | null>(null);
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function applyPromo() {
    setBusy("promo");
    setPromoMsg(null);
    const res = await fetch("/api/billing/promo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: promo }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok && body?.ok) setApplied({ code: body.code, trialDays: body.trialDays });
    else {
      setApplied(null);
      setPromoMsg(body?.error ?? "That code didn't work.");
    }
    setBusy(null);
  }

  async function subscribe(plan: Plan) {
    setBusy(plan);
    setError(null);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, promoCode: applied?.code ?? "" }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok && body?.url) {
      window.location.assign(body.url);
      return;
    }
    setError(body?.error ?? "Couldn't open the payment page. Try again.");
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        {PLANS.map((p) => (
          <div
            key={p.key}
            className={`flex flex-col gap-4 rounded-2xl border bg-white p-6 shadow-sm ${p.highlight ? "border-accent ring-1 ring-accent" : "border-slate-200"}`}
          >
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{p.name}</h2>
              <p className="text-sm text-slate-500">{p.unit}</p>
            </div>
            <p className="text-3xl font-semibold tracking-tight text-slate-900">
              ${price(p.key, seats)}
              <span className="ml-1 text-sm font-normal text-slate-500">/ month for your team</span>
            </p>
            {applied && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {applied.trialDays} days free, then ${price(p.key, seats)}/month. Cancel before then and you pay nothing.
              </p>
            )}
            <ul className="flex flex-col gap-2 text-sm text-slate-600">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-accent">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => subscribe(p.key)}
              disabled={!!busy}
              className={`mt-auto rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${p.highlight ? "bg-accent text-white hover:bg-accent-dark" : "bg-brand text-white hover:bg-brand-dark"}`}
            >
              {busy === p.key ? "Opening…" : applied ? `Start ${applied.trialDays}-day free trial` : `Subscribe to ${p.name}`}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={promo}
          onChange={(e) => setPromo(e.target.value)}
          placeholder="Promo code"
          className="w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase focus:border-brand focus:outline-none"
        />
        <button
          onClick={applyPromo}
          disabled={!promo.trim() || !!busy}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "promo" ? "Checking…" : "Apply"}
        </button>
        {applied && <span className="text-sm text-emerald-700">{applied.code} applied</span>}
        {promoMsg && <span className="text-sm text-red-600">{promoMsg}</span>}
      </div>
      <p className="text-xs text-slate-500">Secure payment by Stripe. Prices in USD.</p>
    </div>
  );
}

export function ManageBillingButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/billing/portal", { method: "POST" }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok && body?.url) window.location.assign(body.url);
    else {
      setError(body?.error ?? "Couldn't open billing.");
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <button onClick={open} disabled={busy} className="self-start rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
        {busy ? "Opening…" : "Manage billing"}
      </button>
      <p className="text-xs text-slate-500">Change your card, see invoices or cancel.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
