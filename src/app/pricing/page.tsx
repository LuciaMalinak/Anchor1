import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "Pricing — Anchor",
};

// Mirrors the tiers from the investor deck's business-model slide —
// Team / Pro / Enterprise, priced per seat rather than flat, with Pro
// as the expansion driver (one leader, then every delegate who covers
// a meeting for them). Deliberately leaves out the deck's internal
// numbers (gross margin, ARR ramp, unit economics) — those are
// investor-only detail, not something a public pricing page shows.
const TIERS = [
  {
    name: "Team",
    price: "$49",
    unit: "/ user / mo",
    tagline: "For a team that just wants meetings handled well.",
    cta: "Start free",
    ctaHref: "/sign-up",
    features: [
      "Agenda enforcement, action tracking, recaps",
      "Meeting recording, transcription, and summaries",
      "Deal and contact tracking",
    ],
  },
  {
    name: "Pro",
    price: "$149",
    unit: "/ leader seat / mo",
    subUnit: "+ $59 / delegate seat / mo",
    tagline: "For teams where someone else has to stand in.",
    highlight: true,
    badge: "Built for delegation",
    cta: "Start free",
    ctaHref: "/sign-up",
    features: [
      "Everything in Team",
      "Pre-meeting briefs generated from your history",
      "Live assist for delegates — in a call or in person",
      "Position bank, person graph, and style profile",
      "Process scoring against your own ideal meeting",
    ],
  },
  {
    name: "Enterprise",
    price: "$250–400",
    unit: "/ seat / mo",
    tagline: "For organizations rolling this out across teams.",
    cta: "Contact us",
    ctaHref: "mailto:lucia.malinak@gmail.com",
    features: [
      "Everything in Pro, delegate seats included",
      "SSO, retention controls, audit log",
      "Org-wide context layer and API access",
      "Custom integrations",
    ],
  },
];

export default function PricingPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-black/10 bg-brand">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-8">
          <Link href="/">
            <Logo size="lg" tone="light" />
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              href="/sign-in"
              className="text-sm font-medium text-slate-300 transition hover:text-white"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10"
            >
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <section className="bg-brand px-6 pb-16 pt-14 text-center sm:px-8">
        <h1 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Priced as a person in the room, not as a note-taker
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-slate-300">
          Land with one leader. Expand to every colleague who covers for them.
        </p>
      </section>

      <section className="mx-auto -mt-10 w-full max-w-6xl px-6 pb-20 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`card-hover flex flex-col gap-6 rounded-2xl border bg-white p-7 shadow-sm ${
                tier.highlight ? "border-accent ring-1 ring-accent" : "border-slate-200"
              }`}
            >
              <div className="flex flex-col gap-2">
                {tier.badge && (
                  <span className="w-fit rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-accent">
                    {tier.badge}
                  </span>
                )}
                <h2 className="text-lg font-semibold text-slate-900">{tier.name}</h2>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-semibold tracking-tight text-slate-900">
                    {tier.price}
                  </span>
                  <span className="text-sm text-slate-500">{tier.unit}</span>
                </div>
                {tier.subUnit && <p className="text-sm text-slate-500">{tier.subUnit}</p>}
                <p className="mt-1 text-sm text-slate-500">{tier.tagline}</p>
              </div>

              <ul className="flex flex-col gap-2.5 text-sm text-slate-600">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className="mt-0.5 text-accent" aria-hidden="true">
                      ✓
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={tier.ctaHref}
                className={`mt-auto rounded-lg px-4 py-2.5 text-center text-sm font-medium shadow-sm ${
                  tier.highlight
                    ? "bg-accent text-white hover:bg-accent-dark"
                    : "border border-slate-300 text-slate-700 hover:border-slate-400"
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-slate-500">
          Every meeting Anchor delegates for is one your team keeps handling well even when
          you&apos;re not in the room. Questions about which tier fits?{" "}
          <a href="mailto:lucia.malinak@gmail.com" className="text-brand hover:underline">
            Reach out
          </a>
          .
        </p>
      </section>

      <footer className="border-t border-slate-200 px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <Logo size="sm" />
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} Anchor. All rights reserved.
          </p>
          <nav className="flex items-center gap-5 text-sm font-medium text-brand">
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
            <Link href="/sign-in" className="hover:underline">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
