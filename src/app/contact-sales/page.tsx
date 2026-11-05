import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ContactSalesForm } from "@/components/ContactSalesForm";

export const metadata = { title: "Contact sales — Anchor" };

export default function ContactSalesPage() {
  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <header className="bg-brand">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <Link href="/">
            <Logo size="lg" tone="light" />
          </Link>
          <Link href="/pricing" className="text-sm font-medium text-slate-300 hover:text-white">
            Pricing
          </Link>
        </div>
      </header>
      <section className="mx-auto w-full max-w-2xl px-6 py-14">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Talk to our sales team</h1>
        <p className="mt-2 text-sm text-slate-500">
          Rolling Anchor out to a larger team, need custom terms, or want a walkthrough first? Tell us a little and
          we&apos;ll reply within one business day.
        </p>
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <ContactSalesForm />
        </div>
      </section>
    </main>
  );
}
