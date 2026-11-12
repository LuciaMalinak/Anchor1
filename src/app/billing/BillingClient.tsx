"use client";

import { useEffect, useRef, useState } from "react";

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

export function BillingPlans({ seats, initialPromo = "" }: { seats: number; initialPromo?: string }) {
  const [promo, setPromo] = useState(initialPromo);
  const [applied, setApplied] = useState<{ code: string; trialDays: number } | null>(null);
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function applyPromo(code = promo) {
    setBusy("promo");
    setPromoMsg(null);
    const res = await fetch("/api/billing/promo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok && body?.ok) setApplied({ code: body.code, trialDays: body.trialDays });
    else {
      setApplied(null);
      setPromoMsg(body?.error ?? "That code didn't work.");
    }
    setBusy(null);
  }

  // A code from the free-trial link is applied as soon as the page opens.
  const autoApplied = useRef(false);
  useEffect(() => {
    if (!initialPromo || autoApplied.current) return;
    autoApplied.current = true;
    void applyPromo(initialPromo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPromo]);

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
          onClick={() => applyPromo()}
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
      <p className="text-xs text-slate-500">Change your card or see invoices.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function longDay(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : null;
}

// The owner's own subscription controls: switch plan, pause or resume
// billing, cancel or keep it (see /api/billing/manage).
export function SubscriptionControls({
  plan,
  seats,
  cancelAt,
  pausedAt,
  resumesAt,
  trialing,
}: {
  plan: Plan;
  seats: number;
  cancelAt: string | null;
  pausedAt: string | null;
  resumesAt: string | null;
  trialing: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState("1");
  const other: Plan = plan === "pro" ? "team" : "pro";

  async function change(body: Record<string, unknown>, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(String(body.action));
    setError(null);
    const res = await fetch("/api/billing/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const d = await res?.json().catch(() => null);
    if (res?.ok) {
      window.location.reload();
      return;
    }
    setError(d?.error ?? "Couldn't change your subscription. Try again.");
    setBusy(null);
  }

  const btn = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

  if (pausedAt) {
    return (
      <div className="flex flex-col gap-3 rounded-lg bg-amber-50 px-4 py-3">
        <p className="text-sm text-amber-900">
          Billing is paused{resumesAt ? ` until ${longDay(resumesAt)}` : ""}. Nothing is charged, and Anchor.AI is locked for your
          team until it resumes. All your data is kept.
        </p>
        <button
          disabled={!!busy}
          onClick={() => change({ action: "resume" }, "Resume your subscription now? Billing restarts and your team gets back in straight away.")}
          className="self-start rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {busy === "resume" ? "Resuming…" : "Resume now"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 border-t border-slate-100 pt-4">
      {cancelAt && (
        <div className="flex flex-col gap-2 rounded-lg bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            Your subscription is cancelled and ends on <b>{longDay(cancelAt)}</b>. Your team keeps full access until then.
          </p>
          <button
            disabled={!!busy}
            onClick={() => change({ action: "keep" }, "Keep your subscription? It will renew as usual.")}
            className="self-start rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {busy === "keep" ? "Saving…" : "Keep my subscription"}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={!!busy}
          onClick={() =>
            change(
              { action: "change-plan", plan: other },
              `Switch to ${other === "pro" ? "Pro" : "Team"} at $${price(other, seats)}/month for ${seats} ${seats === 1 ? "person" : "people"}? ` +
                (trialing ? "Your free trial continues." : "The difference for this month is charged or credited on your next bill."),
            )
          }
          className={other === "pro" ? "rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50" : btn}
        >
          {busy === "change-plan"
            ? "Switching…"
            : `${other === "pro" ? "Upgrade" : "Switch"} to ${other === "pro" ? "Pro" : "Team"} · $${price(other, seats)}/month`}
        </button>
      </div>

      {!cancelAt && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={months} onChange={(e) => setMonths(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
            <option value="1">for 1 month</option>
            <option value="2">for 2 months</option>
            <option value="3">for 3 months</option>
            <option value="6">for 6 months</option>
            <option value="until">until I resume</option>
          </select>
          <button
            disabled={!!busy}
            onClick={() =>
              change(
                { action: "pause", months: months === "until" ? null : Number(months) },
                "Pause billing? Nothing is charged while paused, and Anchor.AI is locked for your team until it resumes. Your data is kept, and you can resume any time.",
              )
            }
            className={btn}
          >
            {busy === "pause" ? "Pausing…" : "Pause billing"}
          </button>
          <button
            disabled={!!busy}
            onClick={() =>
              change(
                { action: "cancel" },
                "Cancel your subscription? Your team keeps access until the end of the period you've paid for, and you can change your mind until then.",
              )
            }
            className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel subscription"}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
