import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { downloadBotAudio, fatalBotMessage, getBotStatus } from "@/lib/recall";
import { saveMeetingAudio } from "@/lib/storage";
import { processMeeting } from "@/lib/processMeeting";

// A bot-joined call only moved on (to transcribing, summarizing, ready)
// when Recall's webhook said the recording was done. When that webhook
// didn't arrive — misconfigured, dropped, or sent while the site was
// asleep — the meeting sat on "Recording…" on Home for good. This asks
// Recall directly how the bot is doing and catches up: in the call ->
// "recording", call over with the recording ready -> fetch it and run the
// usual pipeline, couldn't join -> "failed" with the reason. Checked from
// the pages that show the meeting (at most every CHECK_EVERY_MS per
// meeting) and from the hourly job.

const CHECK_EVERY_MS = 30_000;
const lastCheck = new Map<string, number>();
const LIVE = ["joining", "recording"] as const;

// Downloads a finished bot's recording and hands it to the usual
// pipeline — once: whoever moves the meeting off "joining"/"recording"
// first (this or the webhook) does it, the other does nothing.
export async function ingestBotRecording(meetingId: string, botId: string): Promise<boolean> {
  const [claimed] = await db
    .update(meetings)
    .set({ status: "uploaded", updatedAt: new Date() })
    .where(and(eq(meetings.id, meetingId), inArray(meetings.status, [...LIVE])))
    .returning({ id: meetings.id });
  if (!claimed) return false;
  try {
    const audio = await downloadBotAudio(botId);
    const fileName = `${botId}.mp4`;
    const storagePath = await saveMeetingAudio(meetingId, fileName, audio);
    await db
      .update(meetings)
      .set({ audioFileName: fileName, audioStoragePath: storagePath, updatedAt: new Date() })
      .where(eq(meetings.id, meetingId));
    void processMeeting(meetingId);
  } catch (err) {
    console.error(`[botReconcile] couldn't fetch the recording for bot ${botId}:`, err);
    await db
      .update(meetings)
      .set({ status: "failed", errorMessage: err instanceof Error ? err.message : "Couldn't download the recording", updatedAt: new Date() })
      .where(eq(meetings.id, meetingId));
  }
  return true;
}

// Stop was pressed for a call Anchor Desktop is recording, but the app
// hasn't stopped it this long after (closed, asleep, offline): wrap the
// meeting up from its live transcript (processMeeting falls back to it
// with no audio) instead of leaving it live. If the app uploads the real
// recording later, that meeting has already moved on.
const DESKTOP_STOP_GRACE_MS = 3 * 60_000;

async function reconcileDesktopStop(meeting: { id: string; status: string; stopRequestedAt?: Date | null }) {
  if (!meeting.stopRequestedAt || Date.now() - meeting.stopRequestedAt.getTime() < DESKTOP_STOP_GRACE_MS) return;
  const [ended] = await db
    .update(meetings)
    .set({ status: "uploaded", updatedAt: new Date() })
    .where(and(eq(meetings.id, meeting.id), inArray(meetings.status, [...LIVE])))
    .returning({ id: meetings.id });
  if (ended) void processMeeting(meeting.id);
}

export async function reconcileBotMeeting(meeting: {
  id: string;
  status: string;
  recallBotId: string | null;
  recallRecordingId?: string | null;
  stopRequestedAt?: Date | null;
}): Promise<void> {
  if (!(LIVE as readonly string[]).includes(meeting.status)) return;
  if (!meeting.recallBotId) {
    if (meeting.recallRecordingId) await reconcileDesktopStop(meeting);
    return;
  }
  const now = Date.now();
  if (now - (lastCheck.get(meeting.id) ?? 0) < CHECK_EVERY_MS) return;
  lastCheck.set(meeting.id, now);
  if (lastCheck.size > 2000) lastCheck.clear();

  try {
    const bot = await getBotStatus(meeting.recallBotId);
    if (bot.code === "fatal") {
      await db
        .update(meetings)
        .set({ status: "failed", errorMessage: fatalBotMessage(bot.subCode), updatedAt: new Date() })
        .where(and(eq(meetings.id, meeting.id), inArray(meetings.status, [...LIVE])));
      return;
    }
    if (bot.code === "done" || (bot.code === "call_ended" && bot.hasRecording)) {
      if (bot.hasRecording) await ingestBotRecording(meeting.id, meeting.recallBotId);
      else
        await db
          .update(meetings)
          .set({ status: "failed", errorMessage: "The call ended but Anchor's bot didn't get a recording.", updatedAt: new Date() })
          .where(and(eq(meetings.id, meeting.id), inArray(meetings.status, [...LIVE])));
      return;
    }
    if (bot.code.startsWith("in_call") && meeting.status === "joining") {
      await db
        .update(meetings)
        .set({ status: "recording", updatedAt: new Date() })
        .where(and(eq(meetings.id, meeting.id), eq(meetings.status, "joining")));
    }
  } catch (err) {
    console.error(`[botReconcile] couldn't check bot ${meeting.recallBotId}:`, err);
  }
}

// The hourly job: every bot call still shown as live after 20 minutes.
export async function reconcileStaleBotMeetings(): Promise<number> {
  const rows = await db
    .select({
      id: meetings.id,
      status: meetings.status,
      recallBotId: meetings.recallBotId,
      recallRecordingId: meetings.recallRecordingId,
      stopRequestedAt: meetings.stopRequestedAt,
    })
    .from(meetings)
    .where(
      and(
        inArray(meetings.status, [...LIVE]),
        or(
          and(isNotNull(meetings.recallBotId), lt(meetings.updatedAt, new Date(Date.now() - 20 * 60_000))),
          isNotNull(meetings.stopRequestedAt)
        )
      )
    );
  for (const m of rows) await reconcileBotMeeting(m);
  return rows.length;
}
