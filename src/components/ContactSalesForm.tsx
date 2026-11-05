"use client";

import { useState } from "react";

// "Talk to sales": goes to /api/contact-sales (saved for Admin → Billing
// and emailed to the founder). Used on /contact-sales and /billing.
export function ContactSalesForm({ defaultName = "", defaultEmail = "" }: { defaultName?: string; defaultEmail?: string }) {
  const [form, setForm] = useState({ name: defaultName, email: defaultEmail, company: "", teamSize: "", message: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const field = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const res = await fetch("/api/contact-sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok) setState("sent");
    else {
      setError(body?.error ?? "That didn't send. Please try again.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Thanks! We&apos;ll get back to you at {form.email} within one business day.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input required placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
        <input required type="email" placeholder="Work email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
        <input placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className={field} />
        <select value={form.teamSize} onChange={(e) => setForm({ ...form, teamSize: e.target.value })} className={field}>
          <option value="">Team size</option>
          <option>1-5</option>
          <option>6-20</option>
          <option>21-100</option>
          <option>100+</option>
        </select>
      </div>
      <textarea
        rows={4}
        placeholder="What would you like to know? (pricing for a larger team, a demo, security questions…)"
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
        className={field}
      />
      {/* Hidden from people; bots fill it in. */}
      <input
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={form.website}
        onChange={(e) => setForm({ ...form, website: e.target.value })}
        className="hidden"
        name="website"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="self-start rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
        {state === "sending" ? "Sending…" : "Contact sales"}
      </button>
    </form>
  );
}
