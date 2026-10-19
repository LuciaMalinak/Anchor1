import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings, transcripts } from "@/db/schema";
import { downloadBotAudio, downloadRecordingAudio } from "@/lib/recall";
import { saveMeetingAudio } from "@/lib/storage";
import { processMeeting, whileFetchingAudio } from "@/lib/processMeeting";

type MeetingRow = typeof meetings.$inferSelect;

// A meeting whose audio never reached Anchor (Stop pressed while the
// desktop app was closed, a webhook that never came) still has its
// recording at Recall: fetch it now, so the meeting is written up from
// the real recording rather than only the live transcript. Throws away
// a transcript built from the live lines, since the recording's is
// better. Returns false when Recall has nothing (yet).
export async function fetchMissingRecording(meeting: MeetingRow): Promise<boolean> {
  if (meeting.audioStoragePath) return false;
  return whileFetchingAudio(meeting.id, () => fetchRecording(meeting));
}

async function fetchRecording(meeting: MeetingRow): Promise<boolean> {
  let audio: Buffer | null = null;
  let fileName = "";
  if (meeting.recallRecordingId) {
    audio = await downloadRecordingAudio(meeting.recallRecordingId);
    fileName = `${meeting.recallRecordingId}.mp4`;
  } else if (meeting.recallBotId) {
    audio = await downloadBotAudio(meeting.recallBotId);
    fileName = `${meeting.recallBotId}.mp4`;
  }
  if (!audio?.length) return false;
  const storagePath = await saveMeetingAudio(meeting.id, fileName, audio);
  await db.update(meetings).set({ audioFileName: fileName, audioStoragePath: storagePath, updatedAt: new Date() }).where(eq(meetings.id, meeting.id));
  await db.delete(transcripts).where(and(eq(transcripts.meetingId, meeting.id), eq(transcripts.provider, "live")));
  return true;
}

// "Try again" on a failed meeting: get the real recording if it's still
// missing, then run the write-up again (it reuses a transcript it
// already has, so nothing is transcribed twice).
export async function retryMeeting(meeting: MeetingRow): Promise<{ usedRecording: boolean }> {
  const usedRecording = await fetchMissingRecording(meeting).catch((err) => {
    console.error(`[meetingRecovery] couldn't fetch the recording for ${meeting.id}:`, err);
    return false;
  });
  await db.update(meetings).set({ status: "uploaded", errorMessage: null, updatedAt: new Date() }).where(eq(meetings.id, meeting.id));
  void processMeeting(meeting.id);
  return { usedRecording };
}
