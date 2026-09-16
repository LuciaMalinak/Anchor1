import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { contacts, meetingParticipants, meetings, deals } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

function InitialsAvatar({ label, size = 64 }: { label: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {label[0]?.toUpperCase() || "?"}
    </span>
  );
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id));
  if (!contact || contact.userId !== session.user.id) notFound();

  const contactMeetings = await db
    .select({ meeting: meetings, deal: deals })
    .from(meetingParticipants)
    .innerJoin(meetings, eq(meetingParticipants.meetingId, meetings.id))
    .leftJoin(deals, eq(meetings.dealId, deals.id))
    .where(eq(meetingParticipants.contactId, id))
    .orderBy(desc(meetings.occurredAt));

  const dealsInvolved = Array.from(
    new Map(
      contactMeetings.filter((r) => r.deal).map((r) => [r.deal!.id, r.deal!])
    ).values()
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <InitialsAvatar label={contact.name} />
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{contact.name}</h1>
          <p className="text-sm text-slate-500">
            {[contact.role, contact.company].filter(Boolean).join(" · ") || "No role or company on file"}
          </p>
          {contact.email && <p className="mt-1 text-sm text-slate-400">{contact.email}</p>}
        </div>
      </div>

      {contact.relationshipSummary && (
        <section className="rounded-xl border border-accent/40 bg-accent/5 p-6">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-accent">WHAT ANCHOR KNOWS</p>
          <p className="mt-1 text-sm text-slate-700">{contact.relationshipSummary}</p>
        </section>
      )}

      {dealsInvolved.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-900">Deals</h2>
          <div className="mt-3 flex flex-col gap-2">
            {dealsInvolved.map((d) => (
              <Link
                key={d.id}
                href={`/dashboard/deals/${d.id}`}
                className="rounded-lg bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100"
              >
                {d.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-900">
          Meetings ({contactMeetings.length})
        </h2>
        <div className="mt-3 flex flex-col gap-2">
          {contactMeetings.map(({ meeting, deal }) => (
            <Link
              key={meeting.id}
              href={`/dashboard/meetings/${meeting.id}`}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 hover:border-slate-300"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{meeting.title}</p>
                <p className="text-xs text-slate-500">
                  {meeting.occurredAt.toLocaleDateString()}
                  {deal ? ` · ${deal.name}` : ""}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
