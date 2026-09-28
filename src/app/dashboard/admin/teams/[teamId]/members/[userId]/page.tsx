import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { teams, users, meetings, deals, contacts } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAppOwnerPage, logAdminAccess } from "@/lib/adminAccess";

// Read-only view of one teammate's own meetings and contacts — the two
// tables in this app that are scoped to a person rather than the whole
// team (see the comments on `meetings` and `contacts` in schema.ts).
export default async function AdminMemberPage({
  params,
}: {
  params: Promise<{ teamId: string; userId: string }>;
}) {
  const admin = await requireAppOwnerPage();
  const { teamId, userId } = await params;

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  const [member] = await db.select().from(users).where(eq(users.id, userId));
  if (!team || !member || member.teamId !== teamId) notFound();

  await logAdminAccess(admin.id, teamId, `member:${userId}`);

  const memberMeetings = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      status: meetings.status,
      occurredAt: meetings.occurredAt,
      dealName: deals.name,
    })
    .from(meetings)
    .leftJoin(deals, eq(meetings.dealId, deals.id))
    .where(eq(meetings.userId, userId))
    .orderBy(desc(meetings.occurredAt));

  const memberContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId))
    .orderBy(desc(contacts.lastMeetingAt));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/admin/teams/${teamId}`}
          className="text-xs font-medium text-slate-400 hover:text-brand"
        >
          ← {team.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{member.name || member.email}</h1>
        <p className="text-sm text-slate-500">
          {member.email}
          {member.title ? ` · ${member.title}` : ""}
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium text-slate-900">Meetings ({memberMeetings.length})</h2>
        <div className="mt-3 flex flex-col divide-y divide-slate-100">
          {memberMeetings.map((m) => (
            <Link
              key={m.id}
              href={`/dashboard/admin/meetings/${m.id}`}
              className="flex items-center justify-between gap-4 py-2.5 text-sm hover:text-brand"
            >
              <span className="min-w-0 font-medium text-slate-900">{m.title}</span>
              <span className="shrink-0 text-slate-400">
                {m.dealName ? `${m.dealName} · ` : ""}
                {m.occurredAt.toLocaleDateString()} · {m.status}
              </span>
            </Link>
          ))}
          {memberMeetings.length === 0 && <p className="py-3 text-sm text-slate-400">No meetings.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium text-slate-900">Contacts ({memberContacts.length})</h2>
        <div className="mt-3 flex flex-col divide-y divide-slate-100">
          {memberContacts.map((c) => (
            <div key={c.id} className="py-2.5 text-sm">
              <p className="font-medium text-slate-900">
                {c.name}
                {c.company && <span className="ml-1.5 font-normal text-slate-400">· {c.company}</span>}
                {c.role && <span className="font-normal text-slate-400">, {c.role}</span>}
              </p>
              {c.relationshipSummary && (
                <p className="mt-0.5 text-slate-500">{c.relationshipSummary}</p>
              )}
              {c.notes && <p className="mt-0.5 text-slate-400">Note: {c.notes}</p>}
            </div>
          ))}
          {memberContacts.length === 0 && <p className="py-3 text-sm text-slate-400">No contacts.</p>}
        </div>
      </section>
    </div>
  );
}
