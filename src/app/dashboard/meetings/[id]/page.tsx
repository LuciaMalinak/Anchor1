import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  meetings,
  transcripts,
  summaries,
  meetingParticipants,
  contacts,
  deals,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { canAccessDeal, accessibleDealIds, dealVisibilityWhere } from "@/lib/dealAccess";
import { MeetingStatusPoller } from "./MeetingStatusPoller";
import { MeetingDeleteButton } from "./MeetingDeleteButton";
import { FollowUpEmailDraft } from "./FollowUpEmailDraft";
import { SuggestedInvites } from "./SuggestedInvites";
import { isProviderConfigured } from "@/lib/integrations/config";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { MeetingDealPicker } from "./MeetingDealPicker";
import { LiveMeetingPanel } from "@/components/LiveMeetingPanel";

// Kept as a plain helper outside the component — same reasoning as
// isResearchStale() in companyResearch.ts: reading Date.now() directly
// inside a component's render path trips the "impure function during
// render" rule, so the read lives in an ordinary function called from
// render instead.
function computeMeetingProgress(meeting: {
  status: string;
  scheduledAt: Date | null;
  createdAt: Date;
}) {
  const now = Date.now();
  const scheduledInFuture = Boolean(meeting.scheduledAt && meeting.scheduledAt.getTime() > now);

  // A meeting scheduled for later can legitimately sit in "joining" for
  // hours before its time arrives — only measure staleness from when it
  // was actually supposed to start, not from when it was created.
  const sinceRelevantTime =
    meeting.scheduledAt && meeting.scheduledAt.getTime() > meeting.createdAt.getTime()
      ? meeting.scheduledAt.getTime()
      : meeting.createdAt.getTime();
  const minutesOld = (now - sinceRelevantTime) / 60000;
  const stuckJoining =
    (meeting.status === "joining" || meeting.status === "recording") &&
    !scheduledInFuture &&
    minutesOld > 10;
  const isLiveBotCall =
    (meeting.status === "joining" || meeting.status === "recording") && !scheduledInFuture;

  return { scheduledInFuture, stuckJoining, isLiveBotCall };
}

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
  // anyone who can see that deal (same team, and not restricted to a
  // different one — see src/lib/dealAccess.ts).
  const isOwner = meeting.userId === session.user.id;
  let sharedViaTeam = false;
  if (!isOwner && meeting.dealId) {
    const [deal] = await db.select().from(deals).where(eq(deals.id, meeting.dealId));
    sharedViaTeam = Boolean(
      deal && (await canAccessDeal(session.user.id, meeting.dealId, deal.teamId, deal))
    );
  }
  if (!isOwner && !sharedViaTeam) notFound();

  const googleConfigured = isProviderConfigured("google");

  // Only the owner gets to reassign this meeting's deal (see the PATCH
  // route's comment) — a teammate viewing a shared meeting gets read-only
  // access to the current deal name below instead.
  let currentDealName: string | null = null;
  let dealOptions: { id: string; name: string }[] = [];
  if (meeting.dealId) {
    const [currentDeal] = await db.select({ name: deals.name }).from(deals).where(eq(deals.id, meeting.dealId));
    currentDealName = currentDeal?.name ?? null;
  }
  if (isOwner) {
    const access = await accessibleDealIds(session.user.id);
    if (access) {
      dealOptions = await db
        .select({ id: deals.id, name: deals.name })
        .from(deals)
        .where(dealVisibilityWhere(access))
        .orderBy(deals.name);
    }
  }
  const dealPicker = isOwner && (
    <MeetingDealPicker
      meetingId={id}
      currentDealId={meeting.dealId}
      currentDealName={currentDealName}
      deals={dealOptions}
    />
  );

  if (meeting.status !== "ready") {
    const { scheduledInFuture, stuckJoining, isLiveBotCall } = computeMeetingProgress(meeting);

    const PROCESSING_MESSAGE: Record<string, string> = {
      joining: scheduledInFuture
        ? `Scheduled to join automatically at ${meeting.scheduledAt!.toLocaleString(undefined, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })} — nothing to do until then.`
        : "Waiting for Anchor to join the call…",
      recording: "Recording the call — this will move on automatically once it ends.",
      uploaded: "Queued for transcription…",
      transcribing: "Transcribing the recording…",
      summarizing: "Summarizing and updating what Anchor knows about the people in it…",
    };

    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-900">{meeting.title}</p>
          {(dealPicker || currentDealName) && (
            <div className="mt-1.5 flex justify-center">
              {dealPicker || (
                <Link
                  href={`/dashboard/deals/${meeting.dealId}`}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  {currentDealName}
                </Link>
              )}
            </div>
          )}
          <p className="mt-2 text-sm text-slate-500">
            {meeting.status === "failed"
              ? meeting.errorMessage || "Something went wrong processing this meeting."
              : PROCESSING_MESSAGE[meeting.status] ||
                "Still processing — this page will update automatically."}
          </p>
          {stuckJoining && (
            <p className="mt-3 text-xs text-amber-600">
              This is taking longer than usual. Double-check the meeting link was correct
              and the call is still active — if the bot couldn&apos;t join, this meeting
              won&apos;t update on its own.
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
        {isLiveBotCall && <LiveMeetingPanel meetingId={id} title={meeting.title} />}
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

  // The raw transcript only ever has AssemblyAI's generic "Speaker A" /
  // "Speaker B" labels — this resolves each one to whatever real name is
  // known for that speaker (AI-inferred from the conversation, or set by
  // hand in the panel below), same as the participants list already did.
  // Keyed on a normalized (trimmed/lowercased) label rather than the raw
  // string: processMeeting.ts now resolves AI-inferred labels against the
  // transcript's real ones before storing, but this stays as a second,
  // harmless layer of insurance against any future case/whitespace drift
  // silently breaking the lookup again the way it did before that fix —
  // that failure mode is quiet (falls back to the raw label with no
  // error), so it's worth two guards rather than one.
  function normalizeSpeakerLabel(label: string) {
    return label.trim().toLowerCase();
  }
  const speakerNames = new Map(
    participants.map((p) => [normalizeSpeakerLabel(p.speakerLabel), p.displayName])
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{summary ? "Recap · ready after the call" : "Meeting"}</p>
          <h1 className="mt-1.5 text-3xl text-slate-900">{meeting.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {meeting.occurredAt.toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
          <div className="mt-1.5">
            {dealPicker ||
              (currentDealName && (
                <Link
                  href={`/dashboard/deals/${meeting.dealId}`}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  {currentDealName}
                </Link>
              ))}
          </div>
        </div>
        {isOwner && <MeetingDeleteButton meetingId={id} title={meeting.title} />}
      </div>

      {summary && (
        // At-a-glance tiles, as in the product design's recap screen.
        <div className="grid grid-cols-3 gap-3">
          {[
            { n: summary.keyPoints.length, label: "Key points", tone: "text-slate-900" },
            { n: summary.actionItems.length, label: "Action items", tone: "text-slate-900" },
            {
              n: (summary.dealSignals ?? []).filter((d) => d.type !== "buying_signal").length,
              label: "Open risks",
              tone: "text-accent",
            },
          ].map((tile) => (
            <div key={tile.label} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <p className={`font-serif text-3xl leading-none ${tile.tone}`}>{tile.n}</p>
              <p className="mt-2 text-xs text-slate-500">{tile.label}</p>
            </div>
          ))}
        </div>
      )}

      {summary && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base text-slate-900">Overview</h2>
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

          {summary.dealSignals.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">
                Signals
              </h3>
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
                      {signal.type === "buying_signal"
                        ? "Buying signal"
                        : signal.type === "risk"
                          ? "Risk"
                          : "Blocker"}
                    </span>
                    <span className="text-slate-700">{signal.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {summary && <FollowUpEmailDraft meetingId={id} googleConfigured={googleConfigured} />}

      {summary && transcript && googleConfigured && <SuggestedInvites meetingId={id} />}

      {participants.length > 0 && (
        <ParticipantsPanel meetingId={id} participants={participants} canEdit={isOwner || sharedViaTeam} />
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
