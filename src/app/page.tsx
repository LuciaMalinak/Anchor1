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

const FEATURES = [
  {
    title: "Joins the meeting for you",
    body: "Paste a Zoom, Google Meet, or Teams link and Anchor sends itself in, records, and processes the call automatically — nobody has to remember to hit record.",
  },
  {
    title: "Remembers every relationship",
    body: "Anchor builds a running history of each contact and each deal across every meeting, so anyone on the team can step in already knowing who they're talking to.",
  },
  {
    title: "Flags deals going quiet",
    body: "Stalled accounts surface automatically — no activity in a while, or a meeting that's stuck — so nothing slips through without anyone noticing.",
  },
  {
    title: "Drafts your follow-ups",
    body: "A follow-up email, written from the actual meeting notes, is ready to review and send the moment the call ends.",
  },
  {
    title: "Hands off cleanly",
    body: "Out sick, on vacation, switching accounts — a backup can pick up any deal with a real briefing, not a scramble through old emails.",
  },
  {
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
      <header className="border-b border-white/10 bg-brand">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Logo size="md" tone="light" />
          <Link
            href="/sign-in"
            className="rounded-lg border border-white/20 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/10"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-brand px-6 py-28">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(180,83,31,0.18), transparent 70%)",
          }}
        />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
          <AnchorMark size={48} tone="light" />
          <h1 className="text-4xl font-bold tracking-[0.08em] text-white sm:text-5xl">
            ANCHOR
          </h1>
          <p className="max-w-lg text-lg text-slate-300">
            Your knowledge in the room. Without you in the room.
          </p>
          <p className="max-w-md text-sm text-slate-400">
            Meeting intelligence for teams that sell — Anchor joins the call, remembers what
            matters, and keeps every deal covered.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/sign-in"
              className="rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark"
            >
              Sign in
            </Link>
            <a
              href="#how-it-works"
              className="rounded-lg border border-white/20 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* Before / During / After */}
      <section id="how-it-works" className="border-b border-slate-100 px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <p className="text-center text-xs font-semibold tracking-[0.2em] text-accent">
            HOW IT WORKS
          </p>
          <div className="mt-10 grid gap-10 sm:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} className="flex flex-col items-center gap-2 text-center sm:items-start sm:text-left">
                <p className="text-xs font-semibold tracking-[0.2em] text-accent">
                  {step.n} {step.label.toUpperCase()}
                </p>
                <p className="text-lg font-semibold text-slate-900">{step.title}</p>
                <p className="text-sm leading-relaxed text-slate-500">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="bg-slate-50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-xs font-semibold tracking-[0.2em] text-accent">
            WHAT ANCHOR DOES
          </p>
          <h2 className="mx-auto mt-3 max-w-xl text-center text-2xl font-semibold text-brand">
            Everything that used to live in one person&apos;s head
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <p className="text-sm font-semibold text-slate-900">{f.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 rounded-2xl border border-slate-200 bg-brand px-8 py-12 text-center shadow-sm">
          <h2 className="text-2xl font-semibold text-white">Bring your team&apos;s knowledge with you</h2>
          <p className="max-w-md text-sm text-slate-300">
            Sign in to try Anchor — every new account starts private to you, so it&apos;s safe to
            explore before inviting your team.
          </p>
          <Link
            href="/sign-in"
            className="rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark"
          >
            Sign in
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-200 px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
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
