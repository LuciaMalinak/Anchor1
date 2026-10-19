import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { meetingLiveSegments, meetings } from "@/db/schema";
import { downloadBotAudio, fatalBotMessage, getBotStatus, leaveCall } from "@/lib/recall";
import { saveMeetingAudio } from "@/lib/storage";
import { processMeeting, whileFetchingAudio } from "@/lib/processMeeting";

// A bot-joined call only moved on (to transcribing, summarizing, ready)
// when Recall's webhook said the recording was done. When that webhook
// didn't arrive — misconfigured, dropped, or sent while the site was
// asleep — the meeting sat on "Recording…" on Home for good. This asks
// Recall directly how the bot is doing and catches up: in the call ->
// "recording", call over with the recording ready -> fetch it and run the
// usual pipeline, couldn't join -> "failed" with the reason. Checked from
// the pages that show the meeting (at most every CHECK_EVERY_MS per
// meeting) and from the stuck-meeting sweep (stuckMeetings.ts).

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
  await whileFetchingAudio(meetingId, () => fetchAndProcess(meetingId, botId));
  return true;
}

async function fetchAndProcess(meetingId: string, botId: string) {
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

// A live meeting that has gone quiet this long is treated as over when
// someone starts a new recording (see settleIfStale).
const STALE_LIVE_MS = 15 * 60_000;

// Called when starting a recording or sending the bot finds this person
// already "live" for the same deal: an earlier meeting left live by
// mistake (a closed tab, a stop that never landed, a lost webhook) used
// to refuse every new recording with "Anchor's already in a live
// meeting". Brings it up to date first — a bot call is checked with
// Recall; anything with no new transcript for STALE_LIVE_MS is wrapped
// up from what it has. Returns true if it's still genuinely live.
export async function settleIfStale(meetingId: string): Promise<boolean> {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting || !(LIVE as readonly string[]).includes(meeting.status)) return false;
  if (meeting.recallBotId) {
    lastCheck.delete(meeting.id);
    await reconcileBotMeeting(meeting);
    const [after] = await db.select({ status: meetings.status }).from(meetings).where(eq(meetings.id, meetingId));
    if (!after || !(LIVE as readonly string[]).includes(after.status)) return false;
  }
  const [lastLine] = await db
    .select({ at: meetingLiveSegments.createdAt })
    .from(meetingLiveSegments)
    .where(eq(meetingLiveSegments.meetingId, meetingId))
    .orderBy(desc(meetingLiveSegments.createdAt))
    .limit(1);
  const lastActivity = Math.max(meeting.updatedAt.getTime(), lastLine?.at.getTime() ?? 0);
  if (Date.now() - lastActivity < STALE_LIVE_MS) return true;
  if (meeting.recallBotId) {
    // Recall still says it's in the call but nothing's been heard for a
    // while: tell the bot to leave; its recording arrives as usual.
    await leaveCall(meeting.recallBotId).catch(() => {});
    return false;
  }
  const [ended] = await db
    .update(meetings)
    .set({ status: "uploaded", updatedAt: new Date() })
    .where(and(eq(meetings.id, meetingId), inArray(meetings.status, [...LIVE])))
    .returning({ id: meetings.id });
  if (ended) void processMeeting(meetingId);
  return false;
}
