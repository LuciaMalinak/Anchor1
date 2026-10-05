import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { teams, users, deals } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAppOwnerPage, logAdminAccess } from "@/lib/adminAccess";
import { computeDealHealth, HEALTH_LABEL, HEALTH_BADGE_CLASSES } from "@/lib/dealHealth";
import { loadMemberActivity, timeAgo, isInactive, type MemberActivity } from "@/lib/memberActivity";

// Read-only team overview — members and deals, each linking to its own
// read-only drill-down (member -> their meetings/contacts, deal -> notes/
// files/messages/linked meetings). Opening this page is what actually
// gets logged (see logAdminAccess below); the accounts list above it
// isn't, since nothing team-specific is shown there.
export default async function AdminTeamPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const admin = await requireAppOwnerPage();
  const { teamId } = await params;

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) notFound();

  await logAdminAccess(admin.id, teamId, "team overview");

  const members = await db.select().from(users).where(eq(users.teamId, teamId));
  const activity = await loadMemberActivity(members.map((m) => m.id));
  const teamDeals = await db
    .select()
    .from(deals)
    .where(eq(deals.teamId, teamId))
    .orderBy(desc(deals.updatedAt));
  const memberById = new Map(members.map((m) => [m.id, m]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/admin" className="text-xs font-medium text-slate-400 hover:text-brand">
          ← All accounts
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{team.name}</h1>
        <p className="text-sm text-slate-500">
          {team.industry ? `${team.industry} · ` : ""}Created {team.createdAt.toLocaleDateString()}
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium text-slate-900">Members ({members.length})</h2>
        <div className="mt-3 flex flex-col divide-y divide-slate-100">
          {members.map((m) => (
            <Link
              key={m.id}
              href={`/dashboard/admin/teams/${teamId}/members/${m.id}`}
              className="flex items-center justify-between gap-4 py-2.5 text-sm hover:text-brand"
            >
              <span className="min-w-0">
                <span className="font-medium text-slate-900">{m.name || m.email}</span>
                {m.id === team.ownerUserId && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Owner
                  </span>
                )}
                {m.restrictedToDeals && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Restricted
                  </span>
                )}
                <span className="ml-2 text-slate-400">{m.email}</span>
                {m.title && <span className="ml-2 text-slate-400">· {m.title}</span>}
              </span>
              <MemberActivityCell activity={activity.get(m.id)} />
            </Link>
          ))}
          {members.length === 0 && <p className="py-3 text-sm text-slate-400">No members.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium text-slate-900">Deals ({teamDeals.length})</h2>
        <div className="mt-3 flex flex-col divide-y divide-slate-100">
          {teamDeals.map((d) => {
            const health = computeDealHealth({
              stage: d.stage,
              lastActivityAt: d.updatedAt,
              createdAt: d.createdAt,
            });
            const lead = d.leadUserId ? memberById.get(d.leadUserId) : null;
            return (
              <Link
                key={d.id}
                href={`/dashboard/admin/teams/${teamId}/deals/${d.id}`}
                className="flex items-center justify-between gap-4 py-2.5 text-sm hover:text-brand"
              >
                <span className="min-w-0">
                  <span className="font-medium text-slate-900">{d.name}</span>
                  {d.restricted && (
                    <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                      Restricted
                    </span>
                  )}
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${HEALTH_BADGE_CLASSES[health]}`}
                  >
                    {HEALTH_LABEL[health]}
                  </span>
                </span>
                <span className="shrink-0 text-slate-400">
                  {d.stage}
                  {lead ? ` · ${lead.name || lead.email}` : ""}
                </span>
              </Link>
            );
          })}
          {teamDeals.length === 0 && <p className="py-3 text-sm text-slate-400">No deals.</p>}
        </div>
      </section>
    </div>
  );
}

function MemberActivityCell({ activity: a }: { activity: MemberActivity | undefined }) {
  const last = a?.lastActivity;
  return (
    <span className="shrink-0 text-right text-xs">
      <span
        className={isInactive(a) ? "font-medium text-amber-700" : "text-slate-600"}
        title={a?.lastActiveAt?.toLocaleString()}
      >
        {a?.lastActiveAt ? `Last used ${timeAgo(a.lastActiveAt)}` : "Never used Anchor"}
      </span>
      <span className="block max-w-xs truncate text-slate-400">
        {last
          ? `${last.kind}${last.detail ? `: ${last.detail}` : ""} · ${timeAgo(last.at)}`
          : a?.lastActiveAt
            ? "Only opened the app"
            : ""}
      </span>
    </span>
  );
}
