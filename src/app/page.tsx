import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AnchorMark, Logo } from "@/components/Logo";
import { ProductShowcase } from "@/components/ProductShowcase";

const STEPS = [
  {
    n: "01",
    label: "Before",
    title: "The preparation",
    body: "Upload a past recording or let Anchor join the call live — no manual note-taking, no separate recording app.",
  },
  {
    n: "02",
    label: "During",
    title: "The capture",
    body: "Anchor transcribes the conversation in full, speaker by speaker, so nothing said in the room gets lost after it.",
  },
  {
    n: "03",
    label: "After",
    title: "The memory",
    body: "A summary ships automatically, and everyone you talked to is remembered — so the next meeting starts where this one left off.",
  },
];

const FEATURES = [
  {
    title: "Transcript",
    body: "A full, searchable transcript of every meeting — generated automatically, no manual work.",
    feeds: "FEEDS: THE RECORD",
  },
  {
    title: "Summary",
    body: "The key points, decisions, and next steps, pulled out and written up right after the call ends.",
    feeds: "FEEDS: THE BRIEF",
  },
  {
    title: "People",
    body: "A running memory of everyone you talk to, carried forward automatically into the next conversation.",
    feeds: "FEEDS: CONTINUITY",
  },
  {
    title: "Live join",
    body: "Point Anchor at a meeting URL and it joins on its own — nobody has to remember to hit record.",
    feeds: "FEEDS: THE CAPTURE",
  },
];

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col bg-white">
      {/* Hero — mirrors the deck's title slide: navy, thin rules, tracked wordmark */}
      <section className="bg-brand px-6 py-24">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
          <div className="h-px w-full bg-white/20" />
          <div className="flex flex-col items-center gap-4">
            <AnchorMark size={44} tone="light" />
            <h1 className="text-4xl font-bold tracking-[0.15em] text-white sm:text-5xl">
              ANCHOR
            </h1>
            <p className="max-w-xl text-base text-slate-300 sm:text-lg">
              Your knowledge in the room. Without you in the room.
            </p>
          </div>
          <Link
            href="/sign-in"
            className="rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark"
          >
            Sign in
          </Link>
          <div className="h-px w-full bg-white/20" />
          <div className="flex flex-col gap-3 text-xs font-medium tracking-wide text-slate-300 sm:flex-row sm:gap-10">
            <span>UPLOAD, OR LET ANCHOR JOIN THE CALL</span>
            <span>AUTOMATIC TRANSCRIPT &amp; SUMMARY</span>
            <span>REMEMBERS PEOPLE ACROSS MEETINGS</span>
          </div>
        </div>
      </section>

      {/* How it works — mirrors the deck's Before / During / After solution slide */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold tracking-[0.2em] text-accent">
            I.&nbsp;&nbsp;HOW IT WORKS
          </p>
          <h2 className="mt-2 border-b border-slate-200 pb-6 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            What you know, made portable — before, during, and after
          </h2>
          <div className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-6">
            {STEPS.map((step, i) => (
              <div key={step.n} className="relative">
                <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-accent">
                  <span>{step.n}</span>
                  <span>{step.label.toUpperCase()}</span>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
                {i < STEPS.length - 1 && (
                  <span className="pointer-events-none absolute right-[-1.5rem] top-1 hidden text-accent sm:inline">
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Product — tabbed Before/During/After mockup, matching the deck's product slides */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <ProductShowcase />
        </div>
      </section>

      {/* What Anchor remembers — mirrors the deck's four-column accumulation slide */}
      <section className="bg-slate-50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold tracking-[0.2em] text-accent">
            III.&nbsp;&nbsp;WHAT ANCHOR BUILDS
          </p>
          <h2 className="mt-2 border-b border-slate-200 pb-6 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Every meeting deposits into it. Every brief withdraws from it.
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="border-t-2 border-brand pt-4">
                <h3 className="text-base font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
                <p className="mt-4 text-[11px] font-semibold tracking-[0.15em] text-accent">
                  {f.feeds}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA — bookends the hero */}
      <section className="bg-brand px-6 py-16">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
          <p className="text-lg font-medium text-white">
            The meeting happens anyway. Bring your context to it.
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
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Logo size="sm" />
          <p className="text-xs text-slate-400">Anchor turns meetings into context that carries forward.</p>
        </div>
      </footer>
    </main>
  );
}
