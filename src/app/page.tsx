import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AnchorMark, Logo } from "@/components/Logo";
import { AnchorNeuralField } from "@/components/AnchorNeuralField";
import { INDUSTRIES } from "@/lib/industries";

const STEPS = [
  {
    n: "01",
    label: "Before",
    title: "Prep",
    body: "Walk in already caught up — every deal opens with a rolling brief on the account, the people, and what's changed since last time.",
  },
  {
    n: "02",
    label: "During",
    title: "Capture",
    body: "Send Anchor into the call, record it yourself, or upload it after — nothing about the conversation gets left in someone's head.",
  },
  {
    n: "03",
    label: "After",
    title: "Memory",
    body: "A summary, action items, and a drafted follow-up email are ready before you've closed the tab.",
  },
];

// Small stroke-only glyphs matched to the anchor mark's line-art style
// (round caps/joins, no fill) so the feature grid feels drawn by the same
// hand as the logo, rather than a mismatched icon-pack.
function IconJoin(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={props.className}>
      <rect x="3" y="5.5" width="13" height="13" rx="2.5" />
      <path d="M16 10.5l5-2.75v8.5l-5-2.75" />
    </svg>
  );
}
function IconNetwork(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={props.className}>
      <circle cx="6" cy="7" r="2.25" />
      <circle cx="18" cy="7" r="2.25" />
      <circle cx="12" cy="18" r="2.25" />
      <path d="M7.9 8.3L10.2 16M16.1 8.3L13.8 16M8.2 7H15.8" />
    </svg>
  );
}
function IconFlag(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={props.className}>
      <path d="M6 21V4" />
      <path d="M6 5c2.2-1.5 4.4-1.5 6.5 0s4.3 1.5 6.5 0v9c-2.2 1.5-4.4 1.5-6.5 0s-4.3-1.5-6.5 0" />
    </svg>
  );
}
function IconDraft(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={props.className}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3.5 6.5L12 13l8.5-6.5" />
    </svg>
  );
}
function IconHandoff(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={props.className}>
      <path d="M4 8h11.5M4 8l3.2-3.2M4 8l3.2 3.2" />
      <path d="M20 16H8.5M20 16l-3.2-3.2M20 16l-3.2 3.2" />
    </svg>
  );
}
function IconStack(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={props.className}>
      <path d="M12 3.5l8.5 4.25L12 12 3.5 7.75z" />
      <path d="M3.5 12L12 16.25 20.5 12" />
      <path d="M3.5 16.25L12 20.5l8.5-4.25" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: IconJoin,
    title: "Joins the meeting for you",
    body: "Paste a Zoom, Google Meet, or Teams link and Anchor sends itself in, records, and processes the call automatically — nobody has to remember to hit record.",
  },
  {
    icon: IconNetwork,
    title: "Remembers every relationship",
    body: "Anchor builds a running history of each contact and each deal across every meeting, so anyone on the team can step in already knowing who they're talking to.",
  },
  {
    icon: IconFlag,
    title: "Flags deals going quiet",
    body: "Stalled accounts surface automatically — no activity in a while, or a meeting that's stuck — so nothing slips through without anyone noticing.",
  },
  {
    icon: IconDraft,
    title: "Drafts your follow-ups",
    body: "A follow-up email, written from the actual meeting notes, is ready to review and send the moment the call ends.",
  },
  {
    icon: IconHandoff,
    title: "Hands off cleanly",
    body: "Out sick, on vacation, switching accounts — a backup can pick up any deal with a real briefing, not a scramble through old emails.",
  },
  {
    icon: IconStack,
    title: "One shared record per team",
    body: "Deals, files, and recaps live in one place your whole team can see — instead of scattered across individual inboxes and notes apps.",
  },
];

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col bg-white">
      {/* Top nav */}
      <header className="sticky top-0 z-20 border-b border-black/10 bg-brand shadow-[0_1px_0_0_rgba(0,0,0,0.08)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-8">
          <Logo size="lg" tone="light" />
          <nav className="flex items-center gap-6">
            <a
              href="#how-it-works"
              className="hidden text-sm font-medium text-slate-300 transition hover:text-white sm:inline"
            >
              How it works
            </a>
            <Link
              href="/pricing"
              className="hidden text-sm font-medium text-slate-300 transition hover:text-white sm:inline"
            >
              Pricing
            </Link>
            <Link
              href="/sign-in"
              className="rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-brand px-6 pb-32 pt-16 sm:pb-40 sm:pt-20">
        <div
          aria-hidden="true"
          className="drift-bg pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 65% 55% at 50% 0%, rgba(180,83,31,0.22), transparent 70%), radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "auto, 28px 28px",
          }}
        />
        <AnchorNeuralField />
        <div
          aria-hidden="true"
          className="float-orb pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-accent/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="float-orb pointer-events-none absolute -right-16 bottom-10 h-64 w-64 rounded-full bg-white/10 blur-3xl"
          style={{ animationDelay: "2.5s" }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
          style={{ background: "linear-gradient(to bottom, transparent, rgba(11,25,48,0.6))" }}
        />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-7 text-center">
          <span className="enter-fade enter-1 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[11px] font-semibold tracking-[0.18em] text-slate-200">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            MEETING INTELLIGENCE FOR SALES TEAMS
          </span>
          <div className="enter-fade enter-2 relative">
            <div
              aria-hidden="true"
              className="float-orb pointer-events-none absolute inset-0 -z-10 m-auto h-24 w-24 rounded-full bg-accent/30 blur-2xl"
            />
            <AnchorMark size={72} tone="light" />
          </div>
          <h1 className="enter-fade enter-3 text-5xl font-bold tracking-[0.06em] text-white sm:text-6xl md:text-7xl">
            ANCHOR
          </h1>
          <p className="enter-fade enter-4 max-w-xl text-xl font-medium leading-snug text-slate-200 sm:text-2xl">
            Your knowledge in the room. Without you in the room.
          </p>
          <p className="enter-fade enter-5 max-w-lg text-base leading-relaxed text-slate-400">
            Meeting intelligence for teams that sell — Anchor joins the call, remembers what
            matters, and keeps every deal covered.
          </p>
          <div className="enter-fade enter-6 mt-4 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/sign-in"
              className="group relative overflow-hidden rounded-lg bg-accent px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent-dark"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-700 ease-out group-hover:translate-x-full"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
                }}
              />
              <span className="relative">Sign in</span>
            </Link>
            <a
              href="#how-it-works"
              className="rounded-lg border border-white/25 px-7 py-3 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/10"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* Before / During / After */}
      <section id="how-it-works" className="border-b border-slate-100 px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <p className="text-center text-xs font-semibold tracking-[0.2em] text-accent">
            HOW IT WORKS
          </p>
          <h2 className="mx-auto mt-3 max-w-lg text-center text-3xl font-semibold tracking-tight text-brand">
            One thread through every deal
          </h2>
          <div className="relative mt-16 grid gap-12 sm:grid-cols-3 sm:gap-8">
            <div
              aria-hidden="true"
              className="absolute top-6 right-0 left-0 hidden h-px bg-slate-200 sm:block"
            >
              <span
                className="travel-dot absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent"
                style={{ boxShadow: "0 0 8px 2px rgba(180,83,31,0.6)" }}
              />
            </div>
            {STEPS.map((step, i) => (
              <div
                key={step.n}
                className="reveal relative flex flex-col items-center gap-3 text-center sm:items-start sm:text-left"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <span className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-accent bg-white text-sm font-bold text-accent">
                  {step.n}
                </span>
                <div>
                  <p className="text-xs font-semibold tracking-[0.2em] text-slate-400">
                    {step.label.toUpperCase()}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{step.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI in action — a looping mock of Anchor listening to a call and
          pulling out the parts that matter, so "meeting intelligence"
          isn't just a phrase in the eyebrow copy above. */}
      <section className="relative overflow-hidden border-b border-slate-100 bg-brand-dark px-6 py-24">
        <div
          aria-hidden="true"
          className="drift-bg pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 50% at 15% 0%, rgba(180,83,31,0.18), transparent 70%), radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "auto, 26px 26px",
          }}
        />
        <div className="relative mx-auto max-w-5xl">
          <p className="text-center text-xs font-semibold tracking-[0.2em] text-accent">
            WHILE YOU TALK, ANCHOR LISTENS
          </p>
          <h2 className="mx-auto mt-3 max-w-xl text-center text-3xl font-semibold tracking-tight text-white">
            Every call, understood in real time
          </h2>
          <div className="reveal mt-14 grid gap-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-2xl sm:grid-cols-2">
            {/* Transcript feed */}
            <div className="flex flex-col gap-5 border-b border-white/10 p-7 sm:border-r sm:border-b-0">
              <div className="flex items-center gap-2">
                <span className="live-dot h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
                <p className="text-[11px] font-semibold tracking-[0.15em] text-slate-400">
                  LIVE · ACME CO. RENEWAL CALL
                </p>
              </div>
              <div className="flex min-h-[168px] flex-col gap-4 font-mono text-[13px] leading-relaxed">
                <p className="live-line live-delay-0">
                  <span className="font-semibold text-accent">Sam · Acme Co. </span>
                  <span className="text-slate-300">
                    Budget&apos;s tighter this quarter — we&apos;d need to see ROI within 60
                    days.
                  </span>
                </p>
                <p className="live-line live-delay-1">
                  <span className="font-semibold text-slate-400">You: </span>
                  <span className="text-slate-300">
                    We can structure a phased rollout so you see value fast.
                  </span>
                </p>
                <p className="live-line live-delay-2">
                  <span className="font-semibold text-accent">Sam · Acme Co. </span>
                  <span className="text-slate-300">
                    That works — can you send the updated proposal by Friday?
                  </span>
                </p>
              </div>
            </div>
            {/* Extracted insights */}
            <div className="flex flex-col gap-4 p-7">
              <p className="text-[11px] font-semibold tracking-[0.15em] text-slate-400">
                ANCHOR CAUGHT THIS
              </p>
              <div className="flex min-h-[168px] flex-col justify-center gap-2.5">
                <div className="live-chip live-delay-3 flex items-start gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5">
                  <span className="mt-0.5 text-amber-400" aria-hidden="true">⚑</span>
                  <p className="text-sm text-slate-200">
                    <span className="font-semibold text-white">Risk flagged — </span>
                    budget concerns, 60-day ROI window
                  </p>
                </div>
                <div className="live-chip live-delay-4 flex items-start gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5">
                  <span className="mt-0.5 text-emerald-400" aria-hidden="true">✓</span>
                  <p className="text-sm text-slate-200">
                    <span className="font-semibold text-white">Action item — </span>
                    send updated proposal by Friday
                  </p>
                </div>
                <div className="live-chip live-delay-5 flex items-start gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5">
                  <span className="mt-0.5 text-sky-400" aria-hidden="true">→</span>
                  <p className="text-sm text-slate-200">
                    <span className="font-semibold text-white">Next step — </span>
                    phased rollout proposal drafted
                  </p>
                </div>
              </div>
            </div>
          </div>
          <p className="relative mt-4 text-center text-xs text-slate-500">
            Illustrative example — not a real call or customer.
          </p>
        </div>
      </section>

      {/* Feature grid */}
      <section className="bg-slate-50 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-xs font-semibold tracking-[0.2em] text-accent">
            WHAT ANCHOR DOES
          </p>
          <h2 className="mx-auto mt-3 max-w-xl text-center text-3xl font-semibold tracking-tight text-brand">
            Everything that used to live in one person&apos;s head
          </h2>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="reveal group rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                style={{ animationDelay: `${(i % 3) * 100}ms` }}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/[0.06] text-brand transition duration-300 group-hover:-rotate-3 group-hover:scale-110 group-hover:bg-accent/10 group-hover:text-accent">
                  <f.icon className="h-5 w-5" />
                </div>
                <p className="mt-4 text-base font-semibold text-slate-900">{f.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24">
        <div className="reveal relative mx-auto flex max-w-2xl flex-col items-center gap-5 overflow-hidden rounded-2xl border border-slate-200 bg-brand px-8 py-14 text-center shadow-lg">
          <div
            aria-hidden="true"
            className="float-orb pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(180,83,31,0.2), transparent 70%)",
            }}
          />
          <AnchorMark size={36} tone="light" className="relative" />
          <h2 className="relative text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Bring your team&apos;s knowledge with you
          </h2>
          <p className="relative max-w-md text-sm leading-relaxed text-slate-300">
            Sign in to try Anchor — every new account starts private to you, so it&apos;s safe to
            explore before inviting your team.
          </p>
          <Link
            href="/sign-in"
            className="group relative overflow-hidden rounded-lg bg-accent px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent-dark"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-700 ease-out group-hover:translate-x-full"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
              }}
            />
            <span className="relative">Sign in</span>
          </Link>
        </div>
      </section>

      {/* Industry section — the fixed list a team can pick from on the
          Team page (src/lib/industries.ts). Positioning/copy only for
          now: same Anchor, same AI, under every card — industry-tuned AI
          behavior is a later project, not implied here. */}
      <section className="border-t border-slate-100 bg-slate-50 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-xs font-semibold tracking-[0.2em] text-accent">
            BUILT FOR YOUR INDUSTRY
          </p>
          <h2 className="mx-auto mt-3 max-w-xl text-center text-3xl font-semibold tracking-tight text-brand">
            Anchor speaks your industry
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-sm leading-relaxed text-slate-500">
            Set your team&apos;s industry on the Team page and Anchor carries it through the
            product — starting with a look that matches.
          </p>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {INDUSTRIES.map((ind) => (
              <Link
                key={ind.key}
                href={`/sign-up?industry=${ind.key}`}
                className="reveal group block rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                style={{ borderTopWidth: "3px", borderTopColor: ind.accent }}
              >
                <p className="text-base font-semibold text-slate-900">Anchor for {ind.label}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{ind.blurb}</p>
                <span className="mt-3 inline-block text-xs font-medium text-accent">
                  Get started →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Logo size="sm" />
            <p className="text-xs text-slate-400">
              © {new Date().getFullYear()} Anchor. All rights reserved.
            </p>
            <nav className="flex items-center gap-5 text-sm font-medium text-brand">
              <Link href="/pricing" className="hover:underline">
                Pricing
              </Link>
              <Link href="/terms" className="hover:underline">
                Terms
              </Link>
              <Link href="/privacy" className="hover:underline">
                Privacy
              </Link>
              <Link href="/sign-in" className="hover:underline">
                Sign in
              </Link>
              <Link href="/sign-up" className="hover:underline">
                Sign up
              </Link>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-6">
            <span className="text-xs font-semibold tracking-[0.15em] text-slate-400">
              INDUSTRIES
            </span>
            {INDUSTRIES.map((ind) => (
              <Link
                key={ind.key}
                href={`/sign-up?industry=${ind.key}`}
                className="text-sm font-medium text-brand hover:underline"
              >
                {ind.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
