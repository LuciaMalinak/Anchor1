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
  askLog,
} from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { canAccessDeal, accessibleDealIds, dealVisibilityWhere } from "@/lib/dealAccess";
import { MeetingStatusPoller } from "./MeetingStatusPoller";
import { MeetingDeleteButton } from "./MeetingDeleteButton";
import { FollowUpEmailDraft } from "./FollowUpEmailDraft";
import { SuggestedInvites } from "./SuggestedInvites";
import { isProviderConfigured } from "@/lib/integrations/config";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { MeetingDealPicker } from "./MeetingDealPicker";
import { MeetingRetryButton } from "./MeetingRetryButton";
import { MeetingDealAssign } from "@/components/MeetingDealAssign";
import { LiveMeetingPanel } from "@/components/LiveMeetingPanel";
import { AskAnchorScope } from "@/components/AskAnchorDock";
import { CrmUpdateCard } from "./CrmUpdateCard";
import { authorizeMeeting } from "@/lib/meetingAccess";
import { CRM_NAME, crmTargetFor } from "@/lib/integrations/crmWrite";
import { SlackPostCard } from "./SlackPostCard";
import { DropboxSaveCard } from "./DropboxSaveCard";
import { getSlackConnection } from "@/lib/integrations/slack";
import { getDropboxConnection, dropboxSafeName } from "@/lib/integrations/dropbox";

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

  // "Update Salesforce / HubSpot": only when this meeting's deal is linked
  // to a CRM record and this person has that CRM connected themselves.
  let crmName: string | null = null;
  let crmHint: string | null = null;
  const meetingAccess = await authorizeMeeting(session.user.id, id);
  if (meetingAccess?.deal) {
    const target = await crmTargetFor(session.user.id, meetingAccess.deal);
    if (target.provider) crmName = CRM_NAME[target.provider];
    else if (target.reason === "not_connected" && target.linkedTo) crmHint = CRM_NAME[target.linkedTo];
  }

  // "Post to Slack" / "Save to Dropbox": shown to whoever has that tool
  // connected; each asks for its extra permission on first use.
  const [slackConnection, dropboxConnection] = await Promise.all([
    isProviderConfigured("slack") ? getSlackConnection(session.user.id) : null,
    isProviderConfigured("dropbox") ? getDropboxConnection(session.user.id) : null,
  ]);
  const dropboxFolder = `/Anchor/${dropboxSafeName(meetingAccess?.deal?.name ?? "Meetings")}`;

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
  // Not on a deal yet: add it to one, or start a new deal from it.
  const dealPicker = isOwner && !meeting.dealId ? (
    <MeetingDealAssign meetingId={id} meetingTitle={meeting.title} deals={dealOptions} />
  ) : isOwner && (
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
            <div className="mt-5 flex flex-wrap items-start justify-center gap-3">
              {meeting.status === "failed" && <MeetingRetryButton meetingId={id} />}
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

  // What this viewer asked Ask Anchor during the call (their own only).
  const lookedUp = await db
    .select({ id: askLog.id, question: askLog.question, answer: askLog.answer, createdAt: askLog.createdAt })
    .from(askLog)
    .where(and(eq(askLog.meetingId, id), eq(askLog.userId, session.user.id)))
    .orderBy(asc(askLog.createdAt));
  const askedDuringCall = meeting.liveQuestions ?? [];

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
      <AskAnchorScope label={meeting.title} />
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

          {/* Industry rules this call touched (industryPlaybooks.ts) —
              above everything else, since some need action today. */}
          {summary.complianceFlags.length > 0 && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-red-700">
                Needs review
              </p>
              <ul className="mt-1.5 space-y-1.5 text-sm text-red-900">
                {summary.complianceFlags.map((flag, i) => (
                  <li key={i}>
                    <span className="font-medium">{flag.rule}:</span> {flag.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.industryFacts.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">
                Deal sheet
              </h3>
              <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,10rem)_1fr]">
                {summary.industryFacts.map((fact, i) => (
                  <div key={i} className="contents">
                    <dt className="font-medium text-slate-500">{fact.label}</dt>
                    <dd className="text-slate-700">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </>
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

      {summary && crmName && <CrmUpdateCard meetingId={id} crmName={crmName} />}
      {summary && slackConnection && <SlackPostCard meetingId={id} dealId={meetingAccess?.deal?.id ?? null} />}

      {summary && dropboxConnection && <DropboxSaveCard meetingId={id} defaultFolder={dropboxFolder} />}

      {summary && !crmName && crmHint && (
        <p className="text-xs text-slate-500">
          This deal is linked to {crmHint}.{" "}
          <Link href="/dashboard/integrations" className="font-medium text-brand hover:underline">
            Connect {crmHint}
          </Link>{" "}
          to update it from here after each call.
        </p>
      )}

      {askedDuringCall.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-medium text-slate-900">Questions they asked</h2>
          <p className="mt-0.5 text-xs text-slate-500">Asked during the call, with the answer Anchor suggested.</p>
          <ul className="mt-3 flex flex-col gap-3">
            {askedDuringCall.map((q) => (
              <li key={q.askedAt} className="text-sm">
                <p className="italic text-slate-500">
                  &ldquo;{q.question}&rdquo;{q.askedBy ? <span className="not-italic text-slate-400"> — {q.askedBy}</span> : null}
                </p>
                <p className="mt-0.5 text-slate-800">{q.answer}</p>
                {q.links.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {q.links.map((l) => (
                      <a
                        key={l.url}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-brand/30 px-2 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/10"
                      >
                        {l.label} ↗
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {lookedUp.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-medium text-slate-900">What you looked up</h2>
          <p className="mt-0.5 text-xs text-slate-500">Your Ask Anchor questions from this call. Only you see these.</p>
          <ul className="mt-3 flex flex-col gap-3">
            {lookedUp.map((a) => (
              <li key={a.id} className="text-sm">
                <p className="font-medium text-slate-900">{a.question}</p>
                <p className="mt-0.5 whitespace-pre-line text-slate-600">{a.answer}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

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
