import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { getOrCreateTeamId } from "@/lib/team";
import { TOOL_KIND_LABEL, TOOL_KIND_ORDER } from "@/lib/industryTools";
import { SpecialtyHomeCard } from "../SpecialtyHomeCard";
import { CompanyContextBox } from "@/components/CompanyContextBox";

export const metadata = { title: "Your Anchor" };


// "Anchor for <Company>": the team's own Anchor, built from its website
// (teamSpecialty.ts, specialtyAuto.ts). What Anchor does for exactly their
// business: how it coaches and stands in for them on calls, the rules it
// watches, what it fills in, and the tools made for them. Until it's
// built, the same card as Home to build it.
export default async function SpecialtyPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  const sp = team?.specialty;
  const isOwner = team?.ownerUserId === session.user.id;

  if (!sp) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-brand">Your Anchor</h1>
          <p className="text-sm text-slate-500">An Anchor built for exactly what your company does.</p>
        </div>
        <SpecialtyHomeCard />
        <CompanyContextBox />
      </div>
    );
  }

  const p = sp.playbook;
  const groups = TOOL_KIND_ORDER.filter((k) => k !== "standin")
    .map((k) => ({ kind: k, tools: sp.tools.filter((t) => t.kind === k) }))
    .filter((g) => g.tools.length);

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl bg-brand px-6 py-10 text-white sm:px-10">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent">ANCHOR FOR {sp.companyName.toUpperCase()}</p>
        <h1 className="mt-3 max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">Built for {sp.sectorName.toLowerCase()}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">{sp.summary}</p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-200">
          On every call, Anchor thinks like {p.persona}.
        </p>
      </section>

      <section className="rounded-xl border-2 border-accent/30 bg-white p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">The core of your Anchor</p>
        <h2 className="mt-1 text-lg font-semibold text-brand">Anyone on your team can step in for your lead</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          When your CEO or deal lead can&apos;t be in the room, anyone can run the meeting the way they would: their positions and red lines,
          their answers in their own words, their relationships, and a debrief for them afterwards. On every deal under Tools →{" "}
          <span className="font-medium">Step in for the lead</span>.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {sp.tools
            .filter((t) => t.kind === "standin")
            .map((t) => (
              <li key={t.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                <p className="mt-0.5 text-sm text-slate-500">{t.outcome}</p>
              </li>
            ))}
          {["Stand-in brief", "How the lead decides", "Answer like the lead", "Live cover sheet", "Relationship handover", "Debrief for the lead"].map((n) => (
            <li key={n} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900">{n}</p>
              <p className="mt-0.5 text-xs text-slate-400">On every deal</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-brand">In the room for you</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Whether you&apos;re on the call or someone stands in for you, Anchor keeps it on track, answers in your team&apos;s words, and keeps you
          inside the lines below.
        </p>
        <div className="mt-4 grid gap-5 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">Makes sure every call covers</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
              {p.checklist.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="text-accent" aria-hidden="true">✓</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">Listens for</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
              {p.listenFor.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="text-accent" aria-hidden="true">•</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">Never lets you cross</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {p.guardrails.map((g) => (
                <li key={g.label}>
                  <p className="font-medium text-slate-800">{g.label}</p>
                  <p className="text-slate-500">{g.rule}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {p.pains.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-brand">What slows you down, and what Anchor does about it</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {p.pains.map((x) => (
              <div key={x.pain} className="rounded-xl border border-slate-200 border-t-[3px] border-t-accent bg-white p-5">
                <p className="text-sm text-slate-500">{x.pain}</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{x.anchor}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-brand">Tools made for {sp.companyName}</h2>
        <p className="mt-1 text-sm text-slate-500">
          On every deal under Tools, alongside your industry&apos;s. Each is written from the deal&apos;s calls, files and emails, and updates
          itself after every call.{" "}
          <Link href="/dashboard/deals" className="font-medium text-brand hover:underline">
            Open a deal
          </Link>
        </p>
        {groups.map((g) => (
          <div key={g.kind} className="mt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{TOOL_KIND_LABEL[g.kind]}</h3>
            <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
              {g.tools.map((t) => (
                <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{t.outcome}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold text-brand">Your deal sheet</h2>
          <p className="mt-1 text-sm text-slate-500">Filled in after every call, from what was actually said.</p>
          <dl className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {p.captureFields.map((f) => (
              <div key={f.label} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-4 px-4 py-2.5">
                <dt className="font-medium text-slate-900">{f.label}</dt>
                <dd className="text-slate-500">{f.hint}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-brand">Speaks your language</h2>
          <p className="mt-1 text-sm text-slate-500">Terms Anchor gets right in your transcripts and answers.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {p.vocabulary.map((v) => (
              <span key={v} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                {v}
              </span>
            ))}
          </div>
        </div>
      </section>

      <p className="text-xs text-slate-400">
        Built {new Date(sp.generatedAt).toLocaleDateString()} from {sp.website ? sp.website.replace(/^https?:\/\//, "") : "your description"}.
        {isOwner && (
          <>
            {" "}
            <Link href="/dashboard/profile" className="font-medium text-brand hover:underline">
              Give Anchor more context
            </Link>
          </>
        )}
        {" "}Anchor flags rule-related moments to help you; it isn&apos;t legal or compliance advice.
      </p>
    </div>
  );
}
