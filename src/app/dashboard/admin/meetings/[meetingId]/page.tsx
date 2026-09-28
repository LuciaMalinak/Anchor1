import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { meetings, transcripts, summaries, meetingParticipants, contacts, deals, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAppOwnerPage, logAdminAccess } from "@/lib/adminAccess";

function normalizeSpeakerLabel(label: string) {
  return label.trim().toLowerCase();
}

// Read-only meeting detail — same summary/transcript rendering as the
// real meeting page (src/app/dashboard/meetings/[id]/page.tsx), minus the
// delete/reassign/follow-up-draft controls, which don't belong on a view
// nobody but the app owner is meant to act through.
export default async function AdminMeetingPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const admin = await requireAppOwnerPage();
  const { meetingId } = await params;

  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) notFound();

  const [owner] = await db.select().from(users).where(eq(users.id, meeting.userId));
  const teamId = owner?.teamId;
  if (!teamId) notFound();

  await logAdminAccess(admin.id, teamId, `meeting:${meetingId}`);

  let dealName: string | null = null;
  if (meeting.dealId) {
    const [deal] = await db.select({ name: deals.name }).from(deals).where(eq(deals.id, meeting.dealId));
    dealName = deal?.name ?? null;
  }

  if (meeting.status !== "ready") {
    return (
      <div className="flex flex-col gap-6">
        <Link
          href={`/dashboard/admin/teams/${teamId}/members/${meeting.userId}`}
          className="text-xs font-medium text-slate-400 hover:text-brand"
        >
          ← {owner?.name || owner?.email}
        </Link>
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-900">{meeting.title}</p>
          <p className="mt-2 text-sm text-slate-500">
            {meeting.status === "failed"
              ? meeting.errorMessage || "Something went wrong processing this meeting."
              : `Still ${meeting.status} — nothing to show yet.`}
          </p>
        </div>
      </div>
    );
  }

  const [transcript] = await db.select().from(transcripts).where(eq(transcripts.meetingId, meetingId));
  const [summary] = await db.select().from(summaries).where(eq(summaries.meetingId, meetingId));
  const participants = await db
    .select({
      id: meetingParticipants.id,
      speakerLabel: meetingParticipants.speakerLabel,
      displayName: meetingParticipants.displayName,
      relationshipSummary: contacts.relationshipSummary,
    })
    .from(meetingParticipants)
    .leftJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
    .where(eq(meetingParticipants.meetingId, meetingId));
  const speakerNames = new Map(participants.map((p) => [normalizeSpeakerLabel(p.speakerLabel), p.displayName]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/admin/teams/${teamId}/members/${meeting.userId}`}
          className="text-xs font-medium text-slate-400 hover:text-brand"
        >
          ← {owner?.name || owner?.email}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{meeting.title}</h1>
        <p className="text-sm text-slate-500">
          {meeting.occurredAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          {dealName && meeting.dealId && (
            <>
              {" · "}
              <Link href={`/dashboard/admin/teams/${teamId}/deals/${meeting.dealId}`} className="font-medium text-brand hover:underline">
                {dealName}
              </Link>
            </>
          )}
        </p>
      </div>

      {summary && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-medium text-slate-900">Overview</h2>
          <p className="mt-2 text-sm text-slate-700">{summary.overview}</p>

          {summary.continuityNote && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Continuity</p>
              <p className="mt-1 text-sm text-amber-900">{summary.continuityNote}</p>
            </div>
          )}

          <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">Key points</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {summary.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>

          {summary.actionItems.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">Action items</h3>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {summary.actionItems.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span>•</span>
                    <span>
                      {item.text}
                      {item.owner && <span className="ml-1 text-slate-400">— {item.owner}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {summary.dealSignals.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">Signals</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {summary.dealSignals.map((signal, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        signal.type === "buying_signal"
                          ? "bg-emerald-50 text-emerald-700"
                          : signal.type === "risk"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-red-50 text-red-700"
                      }`}
                    >
                      {signal.type === "buying_signal" ? "Buying signal" : signal.type === "risk" ? "Risk" : "Blocker"}
                    </span>
                    <span className="text-slate-700">{signal.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {participants.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-medium text-slate-900">Participants</h2>
          <div className="mt-3 flex flex-col divide-y divide-slate-100">
            {participants.map((p) => (
              <div key={p.id} className="py-2">
                <p className="text-sm font-medium text-slate-900">{p.displayName || p.speakerLabel}</p>
                {p.relationshipSummary && <p className="text-sm text-slate-500">{p.relationshipSummary}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {transcript && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-medium text-slate-900">Full transcript</h2>
          <div className="mt-3 flex flex-col gap-3">
            {transcript.utterances?.map((u, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium text-slate-900">
                  {speakerNames.get(normalizeSpeakerLabel(u.speakerLabel)) || u.speakerLabel}:{" "}
                </span>
                <span className="text-slate-600">{u.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
