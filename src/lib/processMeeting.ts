import { eq, and, ilike } from "drizzle-orm";
import { db } from "@/db";
import { meetings, transcripts, summaries, contacts, meetingParticipants, deals } from "@/db/schema";
import { transcribeAudioFile } from "./transcribe";
import { summarizeMeeting, mergeContactMemory, mergeDealMemory } from "./summarize";

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

    const { fullText, utterances } = await transcribeAudioFile(
      meeting.audioStoragePath
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

    const result = await summarizeMeeting(utterances);

    const continuityLines: string[] = [];

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
          const { updatedRelationshipSummary, continuityLine } =
            await mergeContactMemory({
              contactName: contact.name,
              priorSummary: contact.relationshipSummary ?? "No prior notes.",
              meetingCount: contact.meetingCount + 1,
              newNote: speaker.note,
            });

          await db
            .update(contacts)
            .set({
              relationshipSummary: updatedRelationshipSummary,
              meetingCount: contact.meetingCount + 1,
              lastMeetingAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(contacts.id, contact.id));

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
        }
      }

      await db.insert(meetingParticipants).values({
        meetingId,
        contactId,
        speakerLabel: speaker.speakerLabel,
        displayName: speaker.inferredName,
      });
    }

    await db.insert(summaries).values({
      meetingId,
      overview: result.overview,
      keyPoints: result.keyPoints,
      actionItems: result.actionItems,
      continuityNote: continuityLines.length > 0 ? continuityLines.join(" ") : null,
    });

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
          const updatedMemory = await mergeDealMemory({
            dealName: deal.name,
            priorMemory: deal.memory,
            newSummary: {
              overview: result.overview,
              keyPoints: result.keyPoints,
              actionItems: result.actionItems,
            },
          });
          await db
            .update(deals)
            .set({ memory: updatedMemory, updatedAt: new Date() })
            .where(eq(deals.id, deal.id));
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
