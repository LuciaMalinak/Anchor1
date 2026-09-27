import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { teams, users, deals, meetings, dealFiles, dealMessages } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAppOwnerPage, logAdminAccess } from "@/lib/adminAccess";
import { computeDealHealth, HEALTH_LABEL, HEALTH_BADGE_CLASSES } from "@/lib/dealHealth";

// Read-only deal detail — everything a teammate can see on the real deal
// page (notes, memory, files, chat, linked meetings), minus every editing
// control. Deliberately its own page rather than reusing DealTabs.tsx:
// that component is wired end-to-end to session-authenticated write
// routes (post a note, change the lead, rename the deal…), and retrofitting
// a read-only mode across all of that would be far riskier to get right
// than a small page that only ever reads.
export default async function AdminDealPage({
  params,
}: {
  params: Promise<{ teamId: string; dealId: string }>;
}) {
  const admin = await requireAppOwnerPage();
  const { teamId, dealId } = await params;

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  const [deal] = await db.select().from(deals).where(and(eq(deals.id, dealId), eq(deals.teamId, teamId)));
  if (!team || !deal) notFound();

  await logAdminAccess(admin.id, teamId, `deal:${dealId}`);

  const members = await db.select().from(users).where(eq(users.teamId, teamId));
  const memberById = new Map(members.map((m) => [m.id, m]));

  const linkedMeetings = await db
    .select()
    .from(meetings)
    .where(eq(meetings.dealId, dealId))
    .orderBy(desc(meetings.occurredAt));

  const files = await db
    .select()
    .from(dealFiles)
    .where(eq(dealFiles.dealId, dealId))
    .orderBy(desc(dealFiles.createdAt));

  const messages = await db
    .select({
      id: dealMessages.id,
      content: dealMessages.content,
      createdAt: dealMessages.createdAt,
      userId: dealMessages.userId,
    })
    .from(dealMessages)
    .where(eq(dealMessages.dealId, dealId))
    .orderBy(dealMessages.createdAt);

  const health = computeDealHealth({ stage: deal.stage, lastActivityAt: deal.updatedAt, createdAt: deal.createdAt });
  const lead = deal.leadUserId ? memberById.get(deal.leadUserId) : null;
  const backup = deal.backupUserId ? memberById.get(deal.backupUserId) : null;
  const creator = memberById.get(deal.createdByUserId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/admin/teams/${teamId}`}
          className="text-xs font-medium text-slate-400 hover:text-brand"
        >
          ← {team.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-slate-900">{deal.name}</h1>
          {deal.restricted && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
              Restricted
            </span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${HEALTH_BADGE_CLASSES[health]}`}>
            {HEALTH_LABEL[health]}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          {deal.stage}
          {lead ? ` · Lead: ${lead.name || lead.email}` : ""}
          {backup ? ` · Backup: ${backup.name || backup.email}` : ""}
          {creator ? ` · Created by ${creator.name || creator.email}` : ""}
        </p>
        {deal.primaryContactName && (
          <p className="text-sm text-slate-500">
            {deal.primaryContactName}
            {deal.primaryContactRole ? `, ${deal.primaryContactRole}` : ""}
            {deal.primaryContactEmail ? ` · ${deal.primaryContactEmail}` : ""}
          </p>
        )}
      </div>

      {(deal.notes || deal.memory) && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          {deal.notes && (
            <>
              <h2 className="text-sm font-medium text-slate-900">Notes</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{deal.notes}</p>
            </>
          )}
          {deal.memory && (
            <>
              <h2 className={deal.notes ? "mt-5 text-sm font-medium text-slate-900" : "text-sm font-medium text-slate-900"}>
                What Anchor has learned
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{deal.memory}</p>
            </>
          )}
        </section>
      )}

      {deal.decisionBoundaries && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-medium text-slate-900">Decision boundaries</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{deal.decisionBoundaries}</p>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium text-slate-900">Meetings ({linkedMeetings.length})</h2>
        <div className="mt-3 flex flex-col divide-y divide-slate-100">
          {linkedMeetings.map((m) => (
            <Link
              key={m.id}
              href={`/dashboard/admin/meetings/${m.id}`}
              className="flex items-center justify-between gap-4 py-2.5 text-sm hover:text-brand"
            >
              <span className="min-w-0 font-medium text-slate-900">{m.title}</span>
              <span className="shrink-0 text-slate-400">
                {m.occurredAt.toLocaleDateString()} · {m.status}
              </span>
            </Link>
          ))}
          {linkedMeetings.length === 0 && <p className="py-3 text-sm text-slate-400">No meetings yet.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium text-slate-900">Files ({files.length})</h2>
        <div className="mt-3 flex flex-col divide-y divide-slate-100">
          {files.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <span className="min-w-0 truncate text-slate-800">{f.fileName}</span>
              <a
                href={`/api/admin/teams/${teamId}/deals/${dealId}/files/${f.id}`}
                className="shrink-0 font-medium text-brand hover:underline"
              >
                Download
              </a>
            </div>
          ))}
          {files.length === 0 && <p className="py-3 text-sm text-slate-400">No files.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium text-slate-900">Chat ({messages.length})</h2>
        <div className="mt-3 flex flex-col gap-3">
          {messages.map((m) => {
            const author = memberById.get(m.userId);
            return (
              <div key={m.id} className="text-sm">
                <span className="font-medium text-slate-900">{author?.name || author?.email || "Unknown"}</span>{" "}
                <span className="text-slate-400">{m.createdAt.toLocaleString()}</span>
                <p className="text-slate-700">{m.content}</p>
              </div>
            );
          })}
          {messages.length === 0 && <p className="text-sm text-slate-400">No messages.</p>}
        </div>
      </section>
    </div>
  );
}
