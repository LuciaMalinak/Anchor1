import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AnchorMark, Logo } from "@/components/Logo";

const STEPS = [
  { n: "01", label: "Before", title: "Prep" },
  { n: "02", label: "During", title: "Capture" },
  { n: "03", label: "After", title: "Memory" },
];

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col bg-white">
      {/* Hero */}
      <section className="bg-brand px-6 py-24">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
          <AnchorMark size={40} tone="light" />
          <h1 className="text-3xl font-bold tracking-[0.1em] text-white sm:text-4xl">
            ANCHOR
          </h1>
          <p className="max-w-md text-base text-slate-300">
            Your knowledge in the room. Without you in the room.
          </p>
          <Link
            href="/sign-in"
            className="rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Before / During / After — short, no filler */}
      <section className="px-6 py-16">
        <div className="mx-auto grid max-w-3xl gap-8 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n} className="text-center">
              <p className="text-xs font-semibold tracking-[0.2em] text-accent">
                {step.n} {step.label.toUpperCase()}
              </p>
              <p className="mt-1 text-base font-semibold text-slate-900">{step.title}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-200 px-6 py-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Logo size="sm" />
          <Link href="/sign-in" className="text-sm font-medium text-brand hover:underline">
            Sign in
          </Link>
        </div>
      </footer>
    </main>
  );
}
