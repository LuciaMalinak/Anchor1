import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ContactSalesForm } from "@/components/ContactSalesForm";

export const metadata = {
  title: "Try Anchor.AI free for 1 week",
  description:
    "The AI assistant for dealmakers and client teams. Live answers on your calls, summaries and follow-ups written for you, and a memory of every deal. Free for 7 days.",
  openGraph: {
    title: "Try Anchor.AI free for 1 week",
    description: "Live answers on your calls, follow-ups written for you, and a memory of every deal. Free for 7 days.",
  },
};

// The landing page for the 1-week free trial (LinkedIn campaign and the
// home page). "Start my free week" goes through /try, which remembers the
// TRYANCHOR code so it's applied on the plans page after sign-up.
const FEATURES = [
  {
    title: "Answers while you're on the call",
    body: "Ask Anchor mid-meeting and get the number, the last thing the client said, or the right reply, from your own deals and notes.",
  },
  {
    title: "Follow-ups written for you",
    body: "Every call ends with a clean summary, action items and a ready-to-send follow-up email. No more notes at 11pm.",
  },
  {
    title: "A memory of every deal",
    body: "Each call, email and file adds to the deal's history, so you walk into the next meeting knowing exactly where things stand.",
  },
  {
    title: "Your morning brief",
    body: "One message each morning: the emails waiting on you, today's meetings, your to-dos and the deals going quiet.",
  },
];

const STEPS = [
  { n: "1", title: "Create your account", body: "Email and password, or sign in with Google. Takes a minute." },
  { n: "2", title: "Your free week is applied", body: "Code TRYANCHOR is added for you. $0 today." },
  { n: "3", title: "Use it on real calls", body: "Cancel any time in the first 7 days and you won't be charged." },
];

export default function FreeTrialPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <header className="bg-brand">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-8">
          <Link href="/">
            <Logo size="lg" tone="light" />
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/pricing" className="hidden text-sm font-medium text-slate-300 hover:text-white sm:inline">
              Pricing
            </Link>
            <Link
              href="/sign-in"
              className="rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white hover:border-white/40 hover:bg-white/10"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <section className="bg-brand px-6 pb-20 pt-14 text-center sm:px-8 sm:pt-20">
        <span className="inline-block rounded-full bg-accent/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#F0B48F]">
          Free for 7 days
        </span>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Try Anchor.AI free for one week
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-300">
          The AI assistant for dealmakers and client teams. It answers questions during your calls, writes the
          summary and follow-up after, and remembers every deal.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="/try"
            className="rounded-lg bg-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-accent-dark"
          >
            Start my free week
          </a>
          <a
            href="#sales"
            className="rounded-lg border border-white/25 px-6 py-3 text-base font-medium text-white hover:border-white/40 hover:bg-white/10"
          >
            Talk to sales
          </a>
        </div>
        <p className="mt-4 text-sm text-slate-400">
          Code <span className="font-semibold text-white">TRYANCHOR</span> is applied automatically · $0 today · cancel
          any time in the first week
        </p>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-8">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-slate-900">What you get in your first week</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-50 px-6 py-16 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-slate-900">How the free week works</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="flex flex-col gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
                  {s.n}
                </span>
                <h3 className="text-base font-semibold text-slate-900">{s.title}</h3>
                <p className="text-sm text-slate-600">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <a href="/try" className="inline-block rounded-lg bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-dark">
              Start my free week
            </a>
            <p className="mt-3 text-xs text-slate-500">
              After the free week: Team $49 per person / month, or Pro $149 + $59 per teammate / month.{" "}
              <Link href="/pricing" className="underline">
                See plans
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section id="sales" className="mx-auto w-full max-w-2xl px-6 py-16 sm:px-8">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Rather talk to someone first?</h2>
        <p className="mb-5 mt-2 text-sm text-slate-600">
          Leave your email and our sales team will reach out shortly: a walkthrough, pricing for a larger team, or any
          questions.
        </p>
        <ContactSalesForm compact />
      </section>

      <footer className="border-t border-slate-200 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <Logo size="sm" />
          <div className="flex gap-4">
            <Link href="/pricing">Pricing</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
