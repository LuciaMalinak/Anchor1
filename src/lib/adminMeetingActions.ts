import { eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings, users } from "@/db/schema";
import { cancelBot, leaveCall } from "@/lib/recall";
import { processMeeting } from "@/lib/processMeeting";
import { deleteMeetingAudio } from "@/lib/storage";
import { logAdminAccess } from "@/lib/adminAccess";

// Stop and Delete for the app owner, from the admin Overview's failed and
// stuck lists (AdminMeetingActions.tsx). Unlike the owner's own Stop
// (api/meetings/[id]/stop), these always get the meeting out of a stuck
// state rather than offering retries.

type Meeting = typeof meetings.$inferSelect;

const STOPPED_BY_SUPPORT = "Stopped by Anchor support.";

async function logFor(adminUserId: string, meeting: Meeting, view: string) {
  const [owner] = await db
    .select({ teamId: users.teamId })
    .from(users)
    .where(eq(users.id, meeting.userId));
  if (owner?.teamId) await logAdminAccess(adminUserId, owner.teamId, view);
}

// Returns a short note on what happened, for the admin UI.
export async function adminStopMeeting(
  adminUserId: string,
  meeting: Meeting,
): Promise<string> {
  await logFor(adminUserId, meeting, `stop-meeting:${meeting.id}`);
  const live = meeting.status === "joining" || meeting.status === "recording";

  if (live && meeting.recallBotId) {
    // Anchor's bot on a Zoom/Teams call: tell it to leave. If it did, the
    // recording webhook moves the meeting on to transcription as usual.
    try {
      await leaveCall(meeting.recallBotId);
      return "Anchor's bot is leaving the call; the meeting will be written up from its recording.";
    } catch {
      await cancelBot(meeting.recallBotId).catch(() => {});
    }
  } else if (live && !meeting.recallRecordingId) {
    // An in-person recording: write it up from its audio if any made it
    // up, otherwise from the live transcript (processMeeting's fallback).
    await db
      .update(meetings)
      .set({ status: "uploaded", updatedAt: new Date() })
      .where(eq(meetings.id, meeting.id));
    void processMeeting(meeting.id);
    return "Stopped. It's being written up from what was recorded.";
  }

  // An Anchor Desktop recording (it can only be stopped on that computer),
  // a bot that couldn't be reached, or processing that never finished:
  // end it in Anchor so it stops showing as live.
  await db
    .update(meetings)
    .set({
      status: "failed",
      errorMessage: STOPPED_BY_SUPPORT,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, meeting.id));
  return "Ended in Anchor.";
}

export async function adminDeleteMeeting(
  adminUserId: string,
  meeting: Meeting,
): Promise<void> {
  await logFor(adminUserId, meeting, `delete-meeting:${meeting.id}`);
  if (
    meeting.recallBotId &&
    (meeting.status === "joining" || meeting.status === "recording")
  ) {
    await leaveCall(meeting.recallBotId).catch(() => {});
    await cancelBot(meeting.recallBotId).catch(() => {});
  }
  // Transcript, summary, live transcript and participants go with it
  // (ON DELETE CASCADE); tasks keep their text but lose the link.
  await db.delete(meetings).where(eq(meetings.id, meeting.id));
  await deleteMeetingAudio(meeting.id).catch((err) =>
    console.error(`[admin] couldn't delete audio for ${meeting.id}:`, err),
  );
}
