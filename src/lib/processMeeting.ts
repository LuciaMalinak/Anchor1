import { eq, and, ilike, ne, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  meetings,
  transcripts,
  summaries,
  contacts,
  contactNotes,
  memorySnapshots,
  meetingParticipants,
  deals,
  tasks,
} from "@/db/schema";
import { transcribeAudioFile } from "./transcribe";
import { summarizeMeeting, mergeContactMemory, mergeDealMemory } from "./summarize";
import { readStoredFile } from "./storage";
import { getOrCreateTeamId } from "./team";
import { withRetry } from "./retry";

// Every Nth memory update re-derives the summary from actual raw history
// instead of just trusting the current (possibly drifted) summary text —
// see mergeContactMemory/mergeDealMemory in summarize.ts. This is what
// lets memory quality self-correct automatically over time rather than
// only ever compounding one incremental edit on top of the last.
const RESYNTHESIS_INTERVAL = 5;
const RESYNTHESIS_HISTORY_LIMIT = 12;

// Orchestrates the full pipeline for one meeting: transcribe -> summarize
// -> resolve speakers against known contacts -> update rolling memory.
//
// This runs in-process, fired off after upload without a queue. That's
// fine for an MVP with a handful of design partners; it is the first
// thing that needs to become a real background job (see
// ENGINEER_BRIEF.md) once usage or audio length grows, since a long
// call can take minutes and an in-process job is lost if the server
// restarts mid-run.
export async function processMeeting(meetingId: string): Promise<void> {
  try {
    await db
      .update(meetings)
      .set({ status: "transcribing", updatedAt: new Date() })
      .where(eq(meetings.id, meetingId));

    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId));
    if (!meeting) throw new Error("Meeting not found");
    if (!meeting.audioStoragePath) throw new Error("No audio file on this meeting");

    const audioBuffer = await readStoredFile(meeting.audioStoragePath);
    if (!audioBuffer) {
      throw new Error("The audio file for this meeting is missing from storage.");
    }

    const { fullText, utterances } = await withRetry(
      () => transcribeAudioFile(audioBuffer),
      { label: `transcribe ${meetingId}` }
    );

    if (utterances.length === 0) {
      throw new Error(
        "No speech was detected in this recording. Check the file has audio and try again."
      );
    }

    await db.insert(transcripts).values({
      meetingId,
      provider: "assemblyai",
      fullText,
      utterances,
    });

    await db
      .update(meetings)
      .set({ status: "summarizing", updatedAt: new Date() })
      .where(eq(meetings.id, meetingId));

    const result = await withRetry(
      () => summarizeMeeting(utterances),
      { label: `summarize ${meetingId}` }
    );

    const continuityLines: string[] = [];

    // The model is only asked to echo back "one entry per distinct
    // speaker label present in the transcript" — nothing forces it to
    // reproduce AssemblyAI's exact string ("Speaker A"), and it has
    // drifted in practice (case, whitespace, or a shortened form). The
    // transcript view (page.tsx) looks up each line's real name by an
    // EXACT match against meetingParticipants.speakerLabel, so any
    // drift here silently broke that lookup while the "People in this
    // meeting" summary — which doesn't need to match anything, it just
    // displays whatever's in this table — looked fine. Resolving
    // against the canonical labels actually present in the utterances
    // (case/whitespace-insensitive) before storing keeps the two in
    // sync regardless of what the model echoes back.
    const canonicalSpeakerLabels = Array.from(
      new Set(utterances.map((u) => u.speakerLabel))
    );
    function resolveSpeakerLabel(raw: string): string {
      const normalize = (s: string) => s.trim().toLowerCase();
      return (
        canonicalSpeakerLabels.find((c) => normalize(c) === normalize(raw)) || raw
      );
    }

    for (const speaker of result.speakers) {
      let contactId: string | null = null;

      if (speaker.inferredName) {
        const existing = await db
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.userId, meeting.userId),
              ilike(contacts.name, speaker.inferredName)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          const contact = existing[0];
          const newMeetingCount = contact.meetingCount + 1;
          const shouldResynthesize = newMeetingCount % RESYNTHESIS_INTERVAL === 0;

          let rawHistory: { note: string; occurredAt: Date }[] | undefined;
          if (shouldResynthesize) {
            const historyRows = await db
              .select({ note: contactNotes.note, occurredAt: contactNotes.createdAt })
              .from(contactNotes)
              .where(eq(contactNotes.contactId, contact.id))
              .orderBy(asc(contactNotes.createdAt))
              .limit(RESYNTHESIS_HISTORY_LIMIT);
            rawHistory = historyRows;
          }

          const { updatedRelationshipSummary, continuityLine, keyChanges } =
            await withRetry(
              () =>
                mergeContactMemory({
                  contactName: contact.name,
                  priorSummary: contact.relationshipSummary ?? "No prior notes.",
                  meetingCount: newMeetingCount,
                  newNote: speaker.note,
                  manualNotes: contact.notes,
                  resynthesize: shouldResynthesize,
                  rawHistory,
                }),
              { label: `contact memory ${contact.id}` }
            );

          await db
            .update(contacts)
            .set({
              relationshipSummary: updatedRelationshipSummary,
              meetingCount: newMeetingCount,
              lastMeetingAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(contacts.id, contact.id));

          await db.insert(contactNotes).values({
            contactId: contact.id,
            meetingId,
            note: speaker.note,
          });

          await db.insert(memorySnapshots).values({
            subjectType: "contact",
            subjectId: contact.id,
            meetingId,
            memory: updatedRelationshipSummary,
            keyChanges,
            method: shouldResynthesize ? "resynthesis" : "incremental",
          });

          contactId = contact.id;
          continuityLines.push(`${contact.name}: ${continuityLine}`);
        } else {
          const [created] = await db
            .insert(contacts)
            .values({
              userId: meeting.userId,
              name: speaker.inferredName,
              relationshipSummary: speaker.note,
              meetingCount: 1,
              lastMeetingAt: new Date(),
            })
            .returning();
          contactId = created.id;

          await db.insert(contactNotes).values({
            contactId: created.id,
            meetingId,
            note: speaker.note,
          });
          await db.insert(memorySnapshots).values({
            subjectType: "contact",
            subjectId: created.id,
            meetingId,
            memory: speaker.note,
            keyChanges: [],
            method: "incremental",
          });
        }
      }

      await db.insert(meetingParticipants).values({
        meetingId,
        contactId,
        speakerLabel: resolveSpeakerLabel(speaker.speakerLabel),
        displayName: speaker.inferredName,
      });
    }

    await db.insert(summaries).values({
      meetingId,
      overview: result.overview,
      keyPoints: result.keyPoints,
      actionItems: result.actionItems,
      continuityNote: continuityLines.length > 0 ? continuityLines.join(" ") : null,
      dealSignals: result.dealSignals,
    });

    // Materialize each action item as its own task row — feeds the home
    // page's cross-deal to-do list. Done here (once, right after the
    // summary that produced them) rather than synthesized from the jsonb
    // array on every read, since a checkbox and comments need a stable id.
    // Best-effort: never let this block the meeting from finishing.
    if (result.actionItems.length > 0) {
      try {
        const teamId = await getOrCreateTeamId(meeting.userId);
        await db.insert(tasks).values(
          result.actionItems.map((item) => ({
            teamId,
            dealId: meeting.dealId,
            text: item.text,
            ownerLabel: item.owner,
            source: "meeting" as const,
            sourceMeetingId: meetingId,
          }))
        );
      } catch (err) {
        console.error(`[processMeeting] task materialization failed for ${meetingId}:`, err);
      }
    }

    await db
      .update(meetings)
      .set({
        status: "ready",
        title: meeting.title || result.suggestedTitle,
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meetingId));

    // Deal-level memory — the same rolling-summary idea as contact
    // memory above, but for the deal as a whole. Best-effort: a failure
    // here shouldn't flip an otherwise-successful meeting to "failed".
    if (meeting.dealId) {
      try {
        const [deal] = await db.select().from(deals).where(eq(deals.id, meeting.dealId));
        if (deal) {
          // How many meetings on this deal have a summary so far
          // (including the one just inserted above) — decides whether
          // this update re-derives from real history instead of just
          // the current memory string. See RESYNTHESIS_INTERVAL.
          const dealMeetingCount = await db
            .select({ id: summaries.id })
            .from(summaries)
            .innerJoin(meetings, eq(summaries.meetingId, meetings.id))
            .where(eq(meetings.dealId, deal.id));
          const shouldResynthesize = dealMeetingCount.length % RESYNTHESIS_INTERVAL === 0;

          let recentMeetings:
            | { overview: string; keyPoints: string[]; actionItems: { text: string; owner: string | null }[]; occurredAt: Date }[]
            | undefined;
          if (shouldResynthesize) {
            recentMeetings = await db
              .select({
                overview: summaries.overview,
                keyPoints: summaries.keyPoints,
                actionItems: summaries.actionItems,
                occurredAt: meetings.occurredAt,
              })
              .from(summaries)
              .innerJoin(meetings, eq(summaries.meetingId, meetings.id))
              .where(and(eq(meetings.dealId, deal.id), ne(meetings.id, meetingId)))
              .orderBy(desc(meetings.occurredAt))
              .limit(RESYNTHESIS_HISTORY_LIMIT);
          }

          const { updatedMemory, keyChanges } = await withRetry(
            () =>
              mergeDealMemory({
                dealName: deal.name,
                priorMemory: deal.memory,
                newSummary: {
                  overview: result.overview,
                  keyPoints: result.keyPoints,
                  actionItems: result.actionItems,
                },
                manualNotes: deal.notes,
                resynthesize: shouldResynthesize,
                recentMeetings,
              }),
            { label: `deal memory ${deal.id}` }
          );

          await db
            .update(deals)
            .set({ memory: updatedMemory, updatedAt: new Date() })
            .where(eq(deals.id, deal.id));

          await db.insert(memorySnapshots).values({
            subjectType: "deal",
            subjectId: deal.id,
            meetingId,
            memory: updatedMemory,
            keyChanges,
            method: shouldResynthesize ? "resynthesis" : "incremental",
          });
        }
      } catch (err) {
        console.error(`[processMeeting] deal memory update failed for ${meetingId}:`, err);
      }
    }
  } catch (err) {
    console.error(`[processMeeting] ${meetingId} failed:`, err);
    await db
      .update(meetings)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "Unknown error",
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meetingId));
  }
}
