import type { Metadata } from "next";
import Link from "next/link";
import { readBriefToken } from "@/lib/briefLink";
import { getBriefRow } from "@/lib/morningBrief";
import type { BriefSnapshot } from "@/lib/morningBriefRender";
import { Logo } from "@/components/Logo";
import { BriefItemActions } from "./BriefItemActions";

export const metadata: Metadata = {
  title: "Your morning brief — Anchor",
  robots: { index: false, follow: false },
};

// The Morning brief's own page, opened from the link in each brief (email,
// text or Slack) without signing in: the latest brief, with Done and
// Snooze for each email. The link is signed and expires after 3 days.
export default async function BriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ item?: string; do?: string }>;
}) {
  const { token } = await params;
  const { item, do: action } = await searchParams;
  const reader = readBriefToken(token);
  const row = reader ? await getBriefRow(reader.userId) : null;
  const brief = (row?.lastBrief ?? null) as BriefSnapshot | null;

  if (!reader || !brief) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f6f9] px-6">
        <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold text-brand">This link has expired</h1>
          <p className="mt-2 text-sm text-slate-600">Brief links work for 3 days. Tomorrow&apos;s brief will have a fresh one.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
            Open Anchor
          </Link>
        </div>
      </main>
    );
  }

  const dismissed = row?.dismissed ?? {};
  const day = new Date(`${brief.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const highlight = action === "done" || action === "snooze" ? action : null;

  return (
    <main className="min-h-screen bg-[#f4f6f9]">
      <header className="bg-brand">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Logo size="md" tone="light" />
          <span className="text-xs text-slate-300">Morning brief · {day}</span>
        </div>
      </header>
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-5 py-8">
        {item && highlight && (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Tap <strong>{highlight === "done" ? "Done" : "Snooze 3 days"}</strong> on the email below to confirm.
          </p>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h1 className="text-base font-semibold text-brand">Waiting on your reply</h1>
          {brief.emails.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              {brief.googleConnected ? "Nothing waiting on you. Nice." : "Connect Google on Anchor's Integrations page to see emails here."}
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {brief.emails.map((e) => {
                const d = dismissed[e.threadId];
                const initial = d === "done" ? "done" : d && d > brief.date ? "snoozed" : null;
                return (
                  <li
                    key={e.threadId}
                    className={`rounded-lg border p-4 ${item === e.threadId ? "border-accent bg-orange-50/40" : "border-slate-200"}`}
                  >
                    <a href={e.gmailUrl} target="_blank" rel="noreferrer" className="text-[15px] font-semibold text-brand hover:underline">
                      {e.fromName}
                    </a>
                    {e.deal && <span className="text-sm text-slate-500"> · {e.deal}</span>}
                    <p className="mt-1 text-[15px] text-slate-700">{e.summary}</p>
                    <p className={`mt-1 text-xs ${e.waitingDays >= 3 ? "text-accent" : "text-slate-400"}`}>
                      Waiting {e.waitingDays <= 0 ? "since today" : `${e.waitingDays} day${e.waitingDays === 1 ? "" : "s"}`}
                      {e.reminder > 1 ? ` · reminder ${e.reminder}` : ""}
                      {e.drafted ? " · reply draft in Gmail" : ""}
                    </p>
                    <div className="mt-3">
                      <BriefItemActions token={token} threadId={e.threadId} initial={initial} highlight={item === e.threadId ? highlight : null} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {brief.moreEmails > 0 && <p className="mt-3 text-sm text-slate-500">+{brief.moreEmails} more in your inbox.</p>}
        </section>

        {brief.meetings.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-brand">Today</h2>
            <ul className="mt-2 flex flex-col gap-1.5 text-[15px] text-slate-700">
              {brief.meetings.map((m, i) => (
                <li key={i}>
                  <span className="font-semibold">{m.time}</span> {m.title}
                </li>
              ))}
            </ul>
          </section>
        )}

        {brief.tasks.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-brand">To do</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-slate-700">
              {brief.tasks.map((t, i) => (
                <li key={i}>
                  {t.text}
                  {t.deal && <span className="text-slate-400"> · {t.deal}</span>}
                </li>
              ))}
            </ul>
            {brief.moreTasks > 0 && <p className="mt-2 text-sm text-slate-500">+{brief.moreTasks} more on your Home page.</p>}
          </section>
        )}

        {brief.quietDeals.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-brand">Gone quiet</h2>
            <ul className="mt-2 flex flex-col gap-1 text-[15px] text-slate-700">
              {brief.quietDeals.map((d, i) => (
                <li key={i}>
                  {d.name} <span className="text-slate-400">· no call in {d.days} days</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-center text-xs text-slate-400">
          Change the time, channel or what&apos;s included on your{" "}
          <Link href="/dashboard/profile" className="underline">
            Anchor profile
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
