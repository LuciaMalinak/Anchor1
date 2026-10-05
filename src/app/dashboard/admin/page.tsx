import Link from "next/link";
import { db } from "@/db";
import { teams, users, deals } from "@/db/schema";
import { eq, desc, sql, notLike } from "drizzle-orm";
import { requireAppOwnerPage } from "@/lib/adminAccess";
import { loadAdminOverview } from "@/lib/adminStats";
import { AdminOverview } from "./AdminOverview";
import { AdminSupportRequests } from "./AdminSupportRequests";
import { loadMemberActivity, timeAgo, isInactive, INACTIVE_AFTER_DAYS } from "@/lib/memberActivity";

// The founder/admin entry point — an Overview of growth, activity and
// recording health across everything (AdminOverview.tsx), then every
// team ("account") in the system,
// searchable by name or owner email, each linking into a read-only view of
// that team's members, deals, meetings, and transcripts. See
// src/lib/adminAccess.ts for the access gate and the accountability
// logging that starts the moment a specific team is opened below (this
// list itself isn't logged — nothing account-specific is visible yet).
export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAppOwnerPage();
  const { q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();

  const [overview, rows, memberCounts, dealCounts, allMembers, activity] = await Promise.all([
    loadAdminOverview(),
    db
      .select({
        id: teams.id,
        name: teams.name,
        createdAt: teams.createdAt,
        ownerUserId: teams.ownerUserId,
        ownerEmail: users.email,
        ownerName: users.name,
      })
      .from(teams)
      .leftJoin(users, eq(users.id, teams.ownerUserId))
      .orderBy(desc(teams.createdAt)),
    db
      .select({ teamId: users.teamId, count: sql<number>`count(*)` })
      .from(users)
      .groupBy(users.teamId),
    db
      .select({ teamId: deals.teamId, count: sql<number>`count(*)` })
      .from(deals)
      .groupBy(deals.teamId),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        teamId: users.teamId,
        teamName: teams.name,
      })
      .from(users)
      .leftJoin(teams, eq(teams.id, users.teamId))
      // Deleted accounts stay as anonymized rows — not real members.
      .where(notLike(users.email, "deleted-%@anchor.invalid")),
    loadMemberActivity(),
  ]);
  // Most recently active first; members who've never used it last.
  const members = allMembers
    .map((m) => ({ ...m, activity: activity.get(m.id) }))
    .sort(
      (a, b) =>
        (b.activity?.lastActiveAt?.getTime() ?? 0) -
        (a.activity?.lastActiveAt?.getTime() ?? 0),
    );
  const inactiveCount = members.filter((m) => isInactive(m.activity)).length;
  const memberCountByTeam = new Map(
    memberCounts.map((r) => [r.teamId, Number(r.count)]),
  );

  const dealCountByTeam = new Map(
    dealCounts.map((r) => [r.teamId, Number(r.count)]),
  );

  const filtered = query
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(query) ||
          (r.ownerEmail && r.ownerEmail.toLowerCase().includes(query)) ||
          (r.ownerName && r.ownerName.toLowerCase().includes(query)),
      )
    : rows;

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
        <p className="mt-1 text-sm text-slate-500">
          Read-only, for support and debugging. Opening an account or a meeting
          writes a permanent, timestamped record of who looked and when; this
          overview doesn&apos;t.
        </p>
      </div>

      <AdminSupportRequests />

      <AdminOverview data={overview} />

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-slate-900">Member activity</h2>
          {inactiveCount > 0 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              {inactiveCount} inactive {INACTIVE_AFTER_DAYS}+ days
            </span>
          )}
        </div>
        {/* What they did, not what it was about — titles and names show on
            the team page, where opening it is logged. */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">Member</th>
                <th className="whitespace-nowrap px-4 py-3">Team</th>
                <th className="whitespace-nowrap px-4 py-3">Last used Anchor</th>
                <th className="whitespace-nowrap px-4 py-3">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => {
                const a = m.activity;
                const inactive = isInactive(a);
                return (
                  <tr key={m.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{m.name || m.email}</p>
                      {m.name && <p className="text-xs text-slate-500">{m.email}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {m.teamId && m.teamName ? (
                        <Link
                          href={`/dashboard/admin/teams/${m.teamId}`}
                          className="hover:text-brand"
                        >
                          {m.teamName}
                        </Link>
                      ) : (
                        "No team"
                      )}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 ${inactive ? "font-medium text-amber-700" : "text-slate-600"}`}
                      title={a?.lastActiveAt?.toLocaleString()}
                    >
                      {a?.lastActiveAt ? timeAgo(a.lastActiveAt) : "Never"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {a?.lastActivity ? (
                        <>
                          {a.lastActivity.kind}{" "}
                          <span className="text-slate-400">
                            · {timeAgo(a.lastActivity.at)}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-400">
                          {a?.lastActiveAt ? "Only opened the app" : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    No members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-slate-900">Accounts</h2>

        <form className="flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by team name or owner email…"
            className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            Search
          </button>
        </form>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">Team</th>
                <th className="whitespace-nowrap px-4 py-3">Owner</th>
                <th className="whitespace-nowrap px-4 py-3">Members</th>
                <th className="whitespace-nowrap px-4 py-3">Deals</th>
                <th className="whitespace-nowrap px-4 py-3">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                    {t.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {t.ownerName || t.ownerEmail || "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {memberCountByTeam.get(t.id) ?? 0}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {dealCountByTeam.get(t.id) ?? 0}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {t.createdAt.toLocaleDateString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/admin/teams/${t.id}`}
                      className="font-medium text-brand hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-slate-400"
                  >
                    No accounts match that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
