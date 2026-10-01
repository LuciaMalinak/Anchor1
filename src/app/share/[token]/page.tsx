import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deals, meetings, summaries, tasks, teams } from "@/db/schema";
import { readShareToken } from "@/lib/shareLink";
import { Logo } from "@/components/Logo";
import { LocalTime } from "./LocalTime";

export const metadata: Metadata = {
  title: "Next steps — Anchor",
  robots: { index: false, follow: false },
};

// The customer-facing next-steps page a deal's team shares by link (see
// /api/deals/[id]/share-link). Shows only what both sides agreed: the
// latest call's action items, ticked off as the team completes them, and
// any scheduled calls. Never the summary, notes, signals or anything else
// internal. Anyone with the link can view it until it expires.
export default async function SharedNextStepsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = readShareToken(token);
  if (!shared) notFound();

  const [deal] = await db.select().from(deals).where(eq(deals.id, shared.dealId));
  if (!deal) notFound();
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, deal.teamId));

  const [latest] = await db
    .select({ meeting: meetings, summary: summaries })
    .from(meetings)
    .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
    .where(and(eq(meetings.dealId, deal.id), eq(meetings.status, "ready")))
    .orderBy(desc(meetings.occurredAt))
    .limit(1);

  const [meetingTasks, upcoming] = await Promise.all([
    // Tasks made from this call's action items; matched on the deal and the
    // item's text, which also covers tasks without a sourceMeetingId.
    latest && latest.summary.actionItems.length
      ? db
          .select({ text: tasks.text, completed: tasks.completed })
          .from(tasks)
          .where(and(eq(tasks.dealId, deal.id), inArray(tasks.text, latest.summary.actionItems.map((a) => a.text))))
      : Promise.resolve([] as { text: string; completed: boolean }[]),
    db
      .select({ title: meetings.title, scheduledAt: meetings.scheduledAt })
      .from(meetings)
      .where(and(eq(meetings.dealId, deal.id), gte(meetings.scheduledAt, new Date())))
      .orderBy(meetings.scheduledAt)
      .limit(5),
  ]);
  const doneTexts = new Set(meetingTasks.filter((t) => t.completed).map((t) => t.text.trim()));
  const items = (latest?.summary.actionItems ?? []).map((a) => ({ ...a, done: doneTexts.has(a.text.trim()) }));
  const doneCount = items.filter((i) => i.done).length;

  return (
    <main className="min-h-screen bg-[#f4f6f9]">
      <header className="bg-brand">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Logo size="md" tone="light" />
          <span className="text-xs text-slate-300">Shared next steps</span>
        </div>
      </header>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">{team?.name ?? "Your team"} × {deal.name}</p>
          <h1 className="mt-2 text-3xl font-semibold text-brand">What we agreed, and who&apos;s doing what</h1>
          {latest && (
            <p className="mt-2 text-sm text-slate-500">
              From the call on{" "}
              {latest.meeting.occurredAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
              {items.length > 0 ? ` · ${doneCount} of ${items.length} done` : ""}
            </p>
          )}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-brand">Next steps</h2>
          {items.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No next steps have been recorded yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {items.map((item, i) => (
                <li key={i} className="flex items-start justify-between gap-4 py-3">
                  <span className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                        item.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    <span className={`text-[15px] ${item.done ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      {item.text}
                      <span className="sr-only">{item.done ? " (done)" : " (open)"}</span>
                    </span>
                  </span>
                  {item.owner && <span className="shrink-0 text-sm text-slate-500">{item.owner}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {upcoming.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-brand">Coming up</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {upcoming.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-4 text-[15px]">
                  <span className="text-slate-800">{m.title}</span>
                  <span className="shrink-0 text-sm text-slate-500">{m.scheduledAt && <LocalTime iso={m.scheduledAt.toISOString()} />}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-center text-xs text-slate-400">
          Shared with Anchor · this link works until{" "}
          {shared.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}
        </p>
      </div>
    </main>
  );
}
