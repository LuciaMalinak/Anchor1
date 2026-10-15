import Link from "next/link";

// Shown on Home until this person turns their Morning brief on, since
// it's off by default and its settings live on the Profile page.
export function MorningBriefPrompt() {
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-brand">Get your morning brief</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Each morning by email, text or Slack: the emails still waiting on your reply, today&apos;s meetings, your to-dos and
          deals going quiet. You choose the time and what&apos;s included.
        </p>
      </div>
      <Link
        href="/dashboard/profile#morning-brief"
        className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
      >
        Set it up
      </Link>
    </section>
  );
}
