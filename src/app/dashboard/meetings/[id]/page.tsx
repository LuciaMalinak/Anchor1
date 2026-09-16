import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  meetings,
  transcripts,
  summaries,
  meetingParticipants,
  contacts,
  deals,
  users,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { MeetingStatusPoller } from "./MeetingStatusPoller";
import { MeetingDeleteButton } from "./MeetingDeleteButton";
import { FollowUpEmailDraft } from "./FollowUpEmailDraft";

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();

  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting) notFound();

  // Visible to whoever created it, or — if it's attached to a deal —
  // anyone on the same team, since deals are shared.
  const isOwner = meeting.userId === session.user.id;
  let sharedViaTeam = false;
  if (!isOwner && meeting.dealId) {
    const [deal] = await db.select().from(deals).where(eq(deals.id, meeting.dealId));
    const [viewer] = await db.select().from(users).where(eq(users.id, session.user.id));
    sharedViaTeam = Boolean(deal && viewer?.teamId && deal.teamId === viewer.teamId);
  }
  if (!isOwner && !sharedViaTeam) notFound();

  if (meeting.status !== "ready") {
    const PROCESSING_MESSAGE: Record<string, string> = {
      joining: "Waiting for Anchor to join the call…",
      recording: "Recording the call — this will move on automatically once it ends.",
      uploaded: "Queued for transcription…",
      transcribing: "Transcribing the recording…",
      summarizing: "Summarizing and updating what Anchor knows about the people in it…",
    };

    const minutesOld = (Date.now() - meeting.createdAt.getTime()) / 60000;
    const stuckJoining =
      (meeting.status === "joining" || meeting.status === "recording") && minutesOld > 10;

    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-slate-900">{meeting.title}</p>
        <p className="mt-2 text-sm text-slate-500">
          {meeting.status === "failed"
            ? meeting.errorMessage || "Something went wrong processing this meeting."
            : PROCESSING_MESSAGE[meeting.status] ||
              "Still processing — this page will update automatically."}
        </p>
        {stuckJoining && (
          <p className="mt-3 text-xs text-amber-600">
            This is taking longer than usual. Double-check the meeting link was correct
            and the call is still active — if the bot couldn't join, this meeting won't
            update on its own.
          </p>
        )}
        {meeting.status !== "failed" && (
          <MeetingStatusPoller meetingId={id} initialStatus={meeting.status} />
        )}
        {isOwner && (meeting.status === "failed" || stuckJoining) && (
          <div className="mt-5 flex justify-center">
            <MeetingDeleteButton meetingId={id} title={meeting.title} />
          </div>
        )}
      </div>
    );
  }

  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.meetingId, id));

  const [summary] = await db
    .select()
    .from(summaries)
    .where(eq(summaries.meetingId, id));

  const participants = await db
    .select({
      id: meetingParticipants.id,
      speakerLabel: meetingParticipants.speakerLabel,
      displayName: meetingParticipants.displayName,
      relationshipSummary: contacts.relationshipSummary,
      meetingCount: contacts.meetingCount,
    })
    .from(meetingParticipants)
    .leftJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
    .where(eq(meetingParticipants.meetingId, id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{meeting.title}</h1>
          <p className="text-sm text-slate-500">
            {meeting.occurredAt.toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        {isOwner && <MeetingDeleteButton meetingId={id} title={meeting.title} />}
      </div>

      {summary && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-medium text-slate-900">Overview</h2>
          <p className="mt-2 text-sm text-slate-700">{summary.overview}</p>

          {summary.continuityNote && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
                Continuity
              </p>
              <p className="mt-1 text-sm text-amber-900">{summary.continuityNote}</p>
            </div>
          )}

          <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">
            Key points
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {summary.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>

          {summary.actionItems.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">
                Action items
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {summary.actionItems.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span>•</span>
                    <span>
                      {item.text}
                      {item.owner && (
                        <span className="ml-1 text-slate-400">— {item.owner}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {summary && <FollowUpEmailDraft meetingId={id} />}

      {participants.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-medium text-slate-900">People in this meeting</h2>
          <div className="mt-3 flex flex-col gap-3">
            {participants.map((p) => (
              <div key={p.id} className="rounded-lg bg-slate-50 px-4 py-3">
                <p className="text-sm font-medium text-slate-900">
                  {p.displayName || p.speakerLabel}
                  {Boolean(p.meetingCount && p.meetingCount > 1) && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {p.meetingCount} meetings
                    </span>
                  )}
                </p>
                {p.relationshipSummary && (
                  <p className="mt-1 text-sm text-slate-600">{p.relationshipSummary}</p>
                )}
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
                <span className="font-medium text-slate-900">{u.speakerLabel}: </span>
                <span className="text-slate-600">{u.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
