import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AnchorMark, Logo } from "@/components/Logo";

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
              href="/sign-in"
              className="rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-brand px-6 py-32 sm:py-40">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 65% 55% at 50% 0%, rgba(180,83,31,0.22), transparent 70%), radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "auto, 28px 28px",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
          style={{ background: "linear-gradient(to bottom, transparent, rgba(11,25,48,0.6))" }}
        />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-7 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[11px] font-semibold tracking-[0.18em] text-slate-200">
            MEETING INTELLIGENCE FOR SALES TEAMS
          </span>
          <AnchorMark size={72} tone="light" />
          <h1 className="text-5xl font-bold tracking-[0.06em] text-white sm:text-6xl md:text-7xl">
            ANCHOR
          </h1>
          <p className="max-w-xl text-xl font-medium leading-snug text-slate-200 sm:text-2xl">
            Your knowledge in the room. Without you in the room.
          </p>
          <p className="max-w-lg text-base leading-relaxed text-slate-400">
            Meeting intelligence for teams that sell — Anchor joins the call, remembers what
            matters, and keeps every deal covered.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/sign-in"
              className="rounded-lg bg-accent px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent-dark"
            >
              Sign in
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
            />
            {STEPS.map((step) => (
              <div key={step.n} className="relative flex flex-col items-center gap-3 text-center sm:items-start sm:text-left">
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
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/[0.06] text-brand transition group-hover:bg-accent/10 group-hover:text-accent">
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
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-5 overflow-hidden rounded-2xl border border-slate-200 bg-brand px-8 py-14 text-center shadow-lg">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
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
            className="relative rounded-lg bg-accent px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent-dark"
          >
            Sign in
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-200 px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <Logo size="sm" />
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} Anchor</p>
          <Link href="/sign-in" className="text-sm font-medium text-brand hover:underline">
            Sign in
          </Link>
        </div>
      </footer>
    </main>
  );
}
