import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AnchorMark, Logo } from "@/components/Logo";
import { INDUSTRIES } from "@/lib/industries";

// The four chapters of the product story, as in the design video: each
// gets a copper "0N · LABEL" eyebrow, a serif headline and a small,
// illustrative window mock (see StepMock below).
const STEPS = [
  {
    n: "01",
    label: "Connect",
    title: "All your context. One place.",
    body: "Connect Gmail, Google Calendar, Slack, Salesforce and HubSpot once. Anchor reads what you already use, so every suggestion comes with a source.",
  },
  {
    n: "02",
    label: "Live, never in the call",
    title: "Listens. Transcribes. Suggests.",
    body: "Anchor Desktop records the call from your own computer: no bot joins, nobody sees it in the participant list. Ask it anything while you talk.",
  },
  {
    n: "03",
    label: "After",
    title: "Recap done. Your tools updated.",
    body: "Decisions, action items and open questions are ready minutes after the call, and every deal's memory is updated for whoever picks it up next.",
  },
  {
    n: "04",
    label: "Follow-up",
    title: "Follow-ups, done for you.",
    body: "A follow-up email drafted from what was actually said, saved to your drafts, plus calendar invites for the next meetings people agreed to.",
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

// Browser-window frame used by every product mock on this page — traffic
// lights and a centred title, like the design video's app windows.
function WindowFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_40px_-18px_rgba(18,41,74,0.28)]">
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50/80 px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ec6a5e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#f4bf4f]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#61c554]" />
        <span className="flex-1 pr-10 text-center text-[11px] text-slate-400">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// Small "where this came from" tag, as on the design's suggestions.
function SourceTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
      {children}
    </span>
  );
}

// Illustrative product mocks for each step. Static markup, not real data.
function StepMock({ n }: { n: string }) {
  if (n === "01") {
    const sources = [
      { name: "Gmail", color: "#d4583a" },
      { name: "Salesforce", color: "#1b96d3" },
      { name: "Google Calendar", color: "#3a78e7" },
      { name: "Slack", color: "#6b3fa0" },
      { name: "HubSpot", color: "#ff7a59" },
      { name: "Past meetings", color: "#12294a" },
    ];
    return (
      <WindowFrame title="Anchor — Sources">
        <p className="eyebrow">Context sources</p>
        <p className="mt-1 font-semibold text-lg text-slate-900">Everything you know, in one place.</p>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {sources.map((src) => (
            <div key={src.name} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5">
              <span className="h-6 w-6 shrink-0 rounded-md" style={{ background: src.color }} aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-[13px] text-slate-900">{src.name}</p>
                <p className="flex items-center gap-1 text-[10px] text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected
                </p>
              </div>
            </div>
          ))}
        </div>
      </WindowFrame>
    );
  }
  if (n === "02") {
    return (
      <WindowFrame title="Anchor">
        <div className="flex items-center justify-between">
          <p className="eyebrow !text-slate-400">Listening on this device · not in the call</p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-red-500" /> Recording
          </span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1.4fr]">
          <div className="flex flex-col gap-3 text-[12.5px] leading-relaxed">
            <p className="live-line live-delay-0">
              <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">Chen Wu</span>
              Before we go further — is nine million really the floor?
            </p>
            <p className="live-line live-delay-1">
              <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">You</span>
              That&apos;s where we landed.
            </p>
          </div>
          <div className="live-chip live-delay-2 rounded-lg border border-slate-200 p-3.5">
            <span className="rounded bg-brand px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-white">SUGGESTED</span>
            <p className="mt-2 font-semibold text-base text-slate-900">Hold at $9M — it&apos;s the floor.</p>
            <p className="mt-1 text-[12px] text-slate-500">Agreed at the Feb 4 board. Chen accepted it by email two days later.</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <SourceTag>Meeting · Feb 4</SourceTag>
              <SourceTag>Gmail · Chen Wu</SourceTag>
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <div className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[12px] text-slate-400">Ask Anchor anything…</div>
          <span className="rounded-lg bg-accent px-4 py-2 text-[12px] font-medium text-white">Ask</span>
        </div>
      </WindowFrame>
    );
  }
  if (n === "03") {
    return (
      <WindowFrame title="Anchor — Recap">
        <p className="eyebrow">Recap · ready 2 minutes after the call</p>
        <p className="mt-1 font-semibold text-lg text-slate-900">Investor sync — Northbridge</p>
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {[
            ["3", "Decisions", "text-slate-900"],
            ["2", "Actions", "text-slate-900"],
            ["1", "Open question", "text-accent"],
          ].map(([num, label, tone]) => (
            <div key={label} className="rounded-lg border border-slate-200 px-3 py-2.5">
              <p className={`font-semibold text-2xl leading-none ${tone}`}>{num}</p>
              <p className="mt-1.5 text-[11px] text-slate-500">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {["Valuation held at $9M", "Reporting stays quarterly"].map((line) => (
            <div key={line} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-[13px]">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[9px] text-white">✓</span>
              <span className="font-semibold text-slate-900">{line}</span>
            </div>
          ))}
          <div className="flex items-center gap-2.5 rounded-lg bg-brand px-3 py-2 text-[12px] text-white">
            <span className="h-4 w-4 rounded bg-accent" aria-hidden="true" /> Follow-up email drafted in Gmail
          </div>
        </div>
      </WindowFrame>
    );
  }
  return (
    <WindowFrame title="Anchor — Next steps">
      <p className="eyebrow">Suggested next steps · from this call</p>
      <p className="mt-1 font-semibold text-lg text-slate-900">Ready when you are.</p>
      <div className="mt-4 rounded-lg border border-slate-200 p-3.5">
        <p className="font-semibold text-[15px] text-slate-900">Follow-up email</p>
        <p className="mt-1.5 text-[12px] text-slate-500">To Chen Wu, Dana Ruiz · Northbridge — next steps</p>
        <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
          Hi Chen, Dana — thanks for today. Confirming the valuation holds at $9M and reporting stays quarterly…
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <span className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600">Edit</span>
          <span className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white">Save to Gmail drafts</span>
        </div>
      </div>
      <div className="mt-2.5 rounded-lg border border-slate-200 p-3.5">
        <p className="font-semibold text-[15px] text-slate-900">Churn cohort review — Northbridge</p>
        <p className="mt-1 text-[12px] text-slate-500">Fri, Oct 2 · 10:00–10:30</p>
        <div className="mt-2.5 flex items-center justify-between">
          <SourceTag>Promised in the call</SourceTag>
          <span className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white">Add to calendar</span>
        </div>
      </div>
    </WindowFrame>
  );
}

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col bg-canvas">
      {/* Top nav */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5 sm:px-8">
          <Logo size="md" />
          <nav className="flex items-center gap-6 text-[13px] font-medium">
            <a href="#how-it-works" className="hidden text-slate-500 transition hover:text-slate-900 sm:inline">
              How it works
            </a>
            <Link href="/pricing" className="hidden text-slate-500 transition hover:text-slate-900 sm:inline">
              Pricing
            </Link>
            <Link
              href="/sign-in"
              className="rounded-md bg-brand px-3.5 py-1.5 text-white transition hover:bg-brand-dark"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 pb-20 pt-16 sm:pt-24">
        <div className="mx-auto max-w-5xl">
          <p className="eyebrow enter-fade enter-1">Meeting intelligence for your desktop</p>
          <h1 className="enter-fade enter-2 mt-4 max-w-3xl text-5xl leading-[1.05] text-brand sm:text-6xl">
            Built for the meeting you can&apos;t attend.
          </h1>
          <p className="enter-fade enter-3 mt-5 max-w-xl text-base leading-relaxed text-slate-600">
            Anchor records your calls right from your desktop, transcribes every one, and answers from your
            email, CRM and past meetings — so what was said stays with the company, not one person&apos;s head.
          </p>
          <div className="enter-fade enter-4 mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/sign-up"
              className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark"
            >
              Get started
            </Link>
            <a
              href="#how-it-works"
              className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400"
            >
              See how it works
            </a>
            <Link href="/sign-in" className="text-sm text-slate-500 hover:text-slate-900">
              or sign in
            </Link>
          </div>

          <div className="enter-fade enter-5 mt-14 grid gap-3 sm:grid-cols-3">
            {[
              { tag: "Listen", title: "Record & transcribe", body: "Runs on your own computer, so no bot has to join the call." },
              { tag: "Connect", title: "All your context", body: "Gmail, Salesforce, HubSpot, calendar, Slack and past meetings." },
              { tag: "Answer", title: "Ask Anchor", body: "Sourced answers, in the moment you need them." },
            ].map((card) => (
              <div key={card.tag} className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <AnchorMark size={22} />
                <p className="eyebrow mt-4 !text-slate-400">{card.tag}</p>
                <p className="mt-1 font-semibold text-lg text-slate-900">{card.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{card.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl bg-brand px-6 py-5">
            <p className="text-lg font-medium text-slate-300">Everyone else optimises the meetings you attend.</p>
            <p className="text-lg font-medium text-white">Anchor is built for the meeting you can&apos;t.</p>
          </div>
        </div>
      </section>

      {/* Statement */}
      <section className="bg-brand px-6 py-24 text-center">
        <p className="font-semibold text-4xl text-white sm:text-5xl">You can&apos;t be in every meeting.</p>
        <p className="mt-3 font-semibold text-4xl text-[#d98a5a] sm:text-5xl">Your context can.</p>
        <span className="mx-auto mt-8 block h-px w-10 bg-accent" aria-hidden="true" />
      </section>

      {/* How it works — the four chapters */}
      <section id="how-it-works" className="px-6 py-24">
        <div className="mx-auto flex max-w-5xl flex-col gap-24">
          <div className="text-center">
            <p className="eyebrow">Meet Anchor</p>
            <h2 className="mt-3 text-4xl text-brand">Meeting context, made portable.</h2>
          </div>
          {STEPS.map((step, i) => (
            <div key={step.n} className="reveal grid items-center gap-10 md:grid-cols-2">
              <div className={i % 2 === 1 ? "md:order-2" : ""}>
                <p className="eyebrow">
                  {step.n} · {step.label}
                </p>
                <h3 className="mt-3 text-3xl leading-tight text-brand">{step.title}</h3>
                <p className="mt-3 max-w-md text-[15px] leading-relaxed text-slate-600">{step.body}</p>
              </div>
              <StepMock n={step.n} />
            </div>
          ))}
          <p className="-mt-16 text-center text-xs text-slate-400">Illustrative examples — not real calls or customers.</p>
        </div>
      </section>

      {/* Feature grid */}
      <section className="border-t border-slate-200/70 bg-white px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="eyebrow text-center">What Anchor does</p>
          <h2 className="mx-auto mt-3 max-w-xl text-center text-4xl text-brand">
            Everything that used to live in one person&apos;s head
          </h2>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="reveal group rounded-xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-16px_rgba(18,41,74,0.3)]"
                style={{ animationDelay: `${(i % 3) * 100}ms` }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-canvas text-brand transition group-hover:text-accent">
                  <f.icon className="h-5 w-5" />
                </div>
                <p className="mt-4 font-semibold text-lg text-slate-900">{f.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Industry section — the fixed list a team can pick from on the
          Team page (src/lib/industries.ts). Positioning/copy only for
          now: same Anchor, same AI, under every card — industry-tuned AI
          behavior is a later project, not implied here. */}
      <section className="border-t border-slate-200/70 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="eyebrow text-center">Built for your industry</p>
          <h2 className="mx-auto mt-3 max-w-xl text-center text-4xl text-brand">Anchor speaks your industry</h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-sm leading-relaxed text-slate-500">
            Set your team&apos;s industry on the Team page and Anchor carries it through the product — starting
            with a look that matches.
          </p>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {INDUSTRIES.map((ind) => (
              <Link
                key={ind.key}
                href={`/sign-up?industry=${ind.key}`}
                className="reveal group block rounded-xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-16px_rgba(18,41,74,0.3)]"
              >
                <span className="block h-1 w-8 rounded-full" style={{ background: ind.accent }} aria-hidden="true" />
                <p className="mt-4 font-semibold text-lg text-slate-900">Anchor for {ind.label}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{ind.blurb}</p>
                <span className="mt-3 inline-block text-xs font-medium text-accent">Get started →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="flex flex-col items-center gap-5 bg-brand px-6 py-24 text-center">
        <AnchorMark size={44} tone="light" />
        <p className="font-semibold text-5xl text-white">Anchor</p>
        <p className="text-xl text-slate-300">Built for the meeting you can&apos;t attend.</p>
        <Link
          href="/sign-up"
          className="mt-3 rounded-md bg-accent px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark"
        >
          Get started
        </Link>
        <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-slate-400">
          Knowledge travels with the company, not the person
        </p>
      </section>

      <footer className="border-t border-slate-200 bg-white px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Logo size="sm" />
              <a
                href="https://www.linkedin.com/company/143888744/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Anchor on LinkedIn"
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-[#0A66C2]"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.15 1.45-2.15 2.94v5.67H9.34V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.11 20.45H3.56V9h3.55v11.45z" />
                </svg>
              </a>
            </div>
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
