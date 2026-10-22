import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { INDUSTRIES, INDUSTRY_BY_KEY, isIndustryKey } from "@/lib/industries";
import { INDUSTRY_PLAYBOOKS } from "@/lib/industryPlaybooks";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  if (!isIndustryKey(key)) return { title: "Anchor" };
  return {
    title: `Anchor for ${INDUSTRY_BY_KEY[key].label}`,
    description: INDUSTRY_PLAYBOOKS[key].focus,
  };
}

// One public page per industry: what people in that business struggle
// with and what Anchor does about each, all read from the same playbook
// the AI uses (src/lib/industryPlaybooks.ts), so the page never promises
// more than the product does.
export default async function IndustryPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isIndustryKey(key)) notFound();
  const industry = INDUSTRY_BY_KEY[key];
  const p = INDUSTRY_PLAYBOOKS[key];
  const accent = { color: industry.accent };

  return (
    <main className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-black/10 bg-brand">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-8">
          <Link href="/">
            <Logo size="lg" tone="light" />
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/sign-in" className="text-sm font-medium text-slate-300 transition hover:text-white">
              Sign in
            </Link>
            <Link
              href={`/sign-up?industry=${key}`}
              className="rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10"
            >
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <section className="bg-brand px-6 pb-16 pt-14 text-center sm:px-8">
        <p className="text-xs font-semibold tracking-[0.2em]" style={{ color: industry.accent }}>
          ANCHOR FOR {industry.label.toUpperCase()}
        </p>
        <h1 className="mx-auto mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          The expert in the room on every call
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-slate-300">{p.focus}.</p>
        <p className="mx-auto mt-2 max-w-2xl text-base text-slate-300">
          Anchor knows what the call has to cover, catches what matters as it&apos;s said, and keeps
          you clear of the lines you can&apos;t cross.
        </p>
        <Link
          href={`/sign-up?industry=${key}`}
          className="mt-8 inline-block rounded-lg px-7 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
          style={{ backgroundColor: industry.accent }}
        >
          Set up Anchor for {industry.label}
        </Link>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-8">
        <h2 className="text-2xl font-semibold tracking-tight text-brand">What slows you down, and what Anchor does about it</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {p.pains.map((item) => (
            <div
              key={item.pain}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              style={{ borderTopWidth: "3px", borderTopColor: industry.accent }}
            >
              <p className="text-sm text-slate-500">{item.pain}</p>
              <p className="mt-3 text-sm font-medium leading-relaxed text-slate-900">{item.anchor}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-100 bg-slate-50 py-16">
        <div className="mx-auto grid max-w-5xl gap-10 px-6 sm:px-8 md:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold text-brand">On the call: what Anchor makes sure you cover</h2>
            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              {p.checklist.map((c) => (
                <li key={c} className="flex items-start gap-2.5">
                  <span className="mt-0.5" style={accent} aria-hidden="true">
                    ✓
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-brand">What it listens for</h2>
            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              {p.listenFor.map((c) => (
                <li key={c} className="flex items-start gap-2.5">
                  <span className="mt-0.5" style={accent} aria-hidden="true">
                    •
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-16 sm:px-8 md:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold text-brand">Lines Anchor watches for you</h2>
          <p className="mt-2 text-sm text-slate-500">
            When a question would take you over one of these, Anchor flags it live and gives you a safe
            way to answer. Anything that came close goes on the call summary for review.
          </p>
          <ul className="mt-4 space-y-3 text-sm">
            {p.guardrails.map((g) => (
              <li key={g.label}>
                <p className="font-medium text-slate-900">{g.label}</p>
                <p className="text-slate-600">{g.rule}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-400">
            Anchor flags these moments to help you. It isn&apos;t legal or compliance advice and
            doesn&apos;t replace your firm&apos;s own policies.
          </p>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-brand">Your deal sheet, filled in from every call</h2>
          <p className="mt-2 text-sm text-slate-500">
            No more typing it up afterwards. After each call Anchor fills in the fields your business
            tracks, from what was actually said.
          </p>
          <dl className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            {p.captureFields.map((f) => (
              <div key={f.label} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-4 px-4 py-2.5">
                <dt className="font-medium text-slate-900">{f.label}</dt>
                <dd className="text-slate-500">{f.hint}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <footer className="mt-auto border-t border-slate-200 px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 sm:px-8">
          <span className="text-xs font-semibold tracking-[0.15em] text-slate-400">INDUSTRIES</span>
          {INDUSTRIES.map((ind) => (
            <Link
              key={ind.key}
              href={`/industries/${ind.key}`}
              className={`text-sm font-medium hover:underline ${ind.key === key ? "text-slate-400" : "text-brand"}`}
            >
              {ind.label}
            </Link>
          ))}
        </div>
      </footer>
    </main>
  );
}
