import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings, transcripts } from "@/db/schema";
import { downloadBotAudio, recordingMediaUrl } from "@/lib/recall";
import { saveMeetingAudio, saveMeetingMediaFromUrl } from "@/lib/storage";
import { goodLiveTranscript, processMeeting, whileFetchingAudio } from "@/lib/processMeeting";

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
  let storagePath: string | null = null;
  let fileName = "";
  if (meeting.recallRecordingId) {
    const media = await recordingMediaUrl(meeting.recallRecordingId);
    if (!media) return false;
    fileName = `${meeting.recallRecordingId}.${media.ext}`;
    storagePath = await saveMeetingMediaFromUrl(meeting.id, fileName, media.url);
  } else if (meeting.recallBotId) {
    const audio = await downloadBotAudio(meeting.recallBotId);
    if (!audio?.length) return false;
    fileName = `${meeting.recallBotId}.mp4`;
    storagePath = await saveMeetingAudio(meeting.id, fileName, audio);
  }
  if (!storagePath) return false;
  await db.update(meetings).set({ audioFileName: fileName, audioStoragePath: storagePath, updatedAt: new Date() }).where(eq(meetings.id, meeting.id));
  // A good live transcript (named speakers, most of the call) stays —
  // the meeting is already written up from it.
  if (!(await goodLiveTranscript(meeting.id))) {
    await db.delete(transcripts).where(and(eq(transcripts.meetingId, meeting.id), eq(transcripts.provider, "live")));
  }
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
