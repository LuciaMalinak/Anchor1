import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, max } from "drizzle-orm";
import { db } from "@/db";
import { meetingLiveSegments, meetings } from "@/db/schema";
import { isProcessing, processMeeting } from "@/lib/processMeeting";
import { reconcileBotMeeting } from "@/lib/botReconcile";
import { fetchMissingRecording } from "@/lib/meetingRecovery";

// Meetings used to get stuck on Home in two ways:
// - "Queued / Transcribing… / Summarizing…" for good: the write-up runs
//   inside the web server, so a restart (every deploy restarts it) killed
//   any write-up in progress and nothing ever picked it back up.
// - "Recording…" for good: the call ended but the tab, desktop app or
//   bot never said so (closed, crashed, asleep, a lost webhook).
// This sweep finds both and finishes them. It runs shortly after the
// server starts and then every few minutes (instrumentation.ts), and
// from the hourly job.

// How long each step may go without progress before it's taken as lost.
// Transcribing a long call can take a while, so it gets the most.
const STUCK_AFTER_MS: Record<string, number> = {
  uploaded: 10 * 60_000,
  transcribing: 30 * 60_000,
  summarizing: 15 * 60_000,
};
// Past this age a meeting that still hasn't finished is marked failed
// (with Try again) rather than restarted forever — e.g. a recording big
// enough to bring the server down each time.
const GIVE_UP_AFTER_MS = 12 * 60 * 60_000;
// A live call with nothing transcribed, and no panel or desktop app
// polling it, for this long is over.
const QUIET_LIVE_MS = 30 * 60_000;
// Bot calls are checked with Recall once they've been live this long.
const BOT_CHECK_AFTER_MS = 5 * 60_000;

// Live meetings whose panel or desktop app asked for updates recently
// (the live route records this) — someone is still on that call.
const lastPolled = new Map<string, number>();
export function noteLivePoll(meetingId: string) {
  lastPolled.set(meetingId, Date.now());
  if (lastPolled.size > 2000) lastPolled.clear();
}

const PROCESSING = ["uploaded", "transcribing", "summarizing"] as const;
// Recall keeps recordings about a week by default.
const RECORDING_CATCH_UP_MS = 7 * 24 * 60 * 60_000;
const RECORDINGS_PER_SWEEP = 2;
// Tried this run of the server and Recall had nothing — not asked again
// until a restart.
const triedRecording = new Set<string>();

// Still on the same step with no progress since the sweep looked — the
// claim, so a second server (or sweep) that read the same row doesn't
// act on it too. (Compared as "older than", not equal: the database keeps
// finer timestamps than JavaScript does.)
function stillStuck(id: string, status: (typeof meetings.$inferSelect)["status"], now: number) {
  return and(
    eq(meetings.id, id),
    eq(meetings.status, status),
    lt(meetings.updatedAt, new Date(now - STUCK_AFTER_MS[status]))
  );
}
const LIVE = ["joining", "recording"] as const;

export async function recoverStuckMeetings(): Promise<{ resumed: number; ended: number; failed: number }> {
  const now = Date.now();
  let resumed = 0;
  let ended = 0;
  let failed = 0;

  // 1. Write-ups that stopped part-way.
  const processing = await db
    .select()
    .from(meetings)
    .where(and(inArray(meetings.status, [...PROCESSING]), lt(meetings.updatedAt, new Date(now - STUCK_AFTER_MS.uploaded))));
  for (const m of processing) {
    if (isProcessing(m.id) || now - m.updatedAt.getTime() < STUCK_AFTER_MS[m.status]) continue;
    if (now - m.createdAt.getTime() > GIVE_UP_AFTER_MS) {
      const [gaveUp] = await db
        .update(meetings)
        .set({
          status: "failed",
          errorMessage: "Anchor couldn't finish writing this meeting up. Press Try again — nothing recorded is lost.",
          updatedAt: new Date(),
        })
        .where(stillStuck(m.id, m.status, now))
        .returning({ id: meetings.id });
      if (gaveUp) failed++;
      continue;
    }
    const [claimed] = await db
      .update(meetings)
      .set({ updatedAt: new Date() })
      .where(stillStuck(m.id, m.status, now))
      .returning({ id: meetings.id });
    if (!claimed) continue;
    // Stopped from the desktop app or website and still waiting for the
    // app's recording: use it if Recall has it, otherwise the write-up
    // falls back to the live transcript.
    if (m.status === "uploaded" && m.recallRecordingId && !m.audioStoragePath) {
      await fetchMissingRecording(m).catch((err) => console.error(`[stuckMeetings] no recording for ${m.id} yet:`, err));
    }
    console.log(`[stuckMeetings] resuming the write-up of ${m.id} (was "${m.status}")`);
    void processMeeting(m.id);
    resumed++;
  }

  // 2. Desktop recordings Anchor never got (it only looked for an audio
  // file Recall doesn't make for them) — fetched now while Recall still
  // has them, a couple per sweep. A meeting that failed for want of its
  // recording is written up again; one already written up from its live
  // transcript just gets the recording kept.
  const missing = await db
    .select()
    .from(meetings)
    .where(
      and(
        inArray(meetings.status, ["ready", "failed"]),
        isNotNull(meetings.recallRecordingId),
        isNull(meetings.audioStoragePath),
        gt(meetings.createdAt, new Date(now - RECORDING_CATCH_UP_MS))
      )
    )
    .orderBy(desc(meetings.createdAt))
    .limit(20);
  let fetched = 0;
  for (const m of missing) {
    if (fetched >= RECORDINGS_PER_SWEEP || triedRecording.has(m.id) || isProcessing(m.id)) continue;
    triedRecording.add(m.id);
    const got = await fetchMissingRecording(m).catch((err) => {
      console.error(`[stuckMeetings] couldn't fetch the recording for ${m.id}:`, err);
      return false;
    });
    if (!got) continue;
    fetched++;
    triedRecording.delete(m.id);
    console.log(`[stuckMeetings] saved the missing recording for ${m.id}`);
    if (m.status === "failed") {
      await db.update(meetings).set({ status: "uploaded", errorMessage: null, updatedAt: new Date() }).where(eq(meetings.id, m.id));
      void processMeeting(m.id);
      resumed++;
    }
  }

  // 3. Calls still shown as live.
  const live = await db
    .select()
    .from(meetings)
    .where(and(inArray(meetings.status, [...LIVE]), lt(meetings.updatedAt, new Date(now - BOT_CHECK_AFTER_MS))));
  if (!live.length) return { resumed, ended, failed };
  const lastLines = await db
    .select({ meetingId: meetingLiveSegments.meetingId, at: max(meetingLiveSegments.createdAt) })
    .from(meetingLiveSegments)
    .where(
      and(
        inArray(meetingLiveSegments.meetingId, live.map((m) => m.id)),
        gt(meetingLiveSegments.createdAt, new Date(now - QUIET_LIVE_MS))
      )
    )
    .groupBy(meetingLiveSegments.meetingId);
  const heardRecently = new Set(lastLines.map((l) => l.meetingId));

  for (const m of live) {
    if (m.recallBotId || m.stopRequestedAt) {
      // A bot call: Recall knows whether it's over, so ask it. Stop
      // pressed for a desktop recording: wrapped up if the app never did.
      await reconcileBotMeeting(m);
      continue;
    }
    const quiet =
      !heardRecently.has(m.id) &&
      now - m.updatedAt.getTime() > QUIET_LIVE_MS &&
      now - (lastPolled.get(m.id) ?? 0) > QUIET_LIVE_MS;
    if (!quiet) continue;
    const [claimed] = await db
      .update(meetings)
      .set({ status: "uploaded", updatedAt: new Date() })
      .where(and(eq(meetings.id, m.id), inArray(meetings.status, [...LIVE])))
      .returning({ id: meetings.id });
    if (!claimed) continue;
    console.log(`[stuckMeetings] ${m.id} has been quiet for ${Math.round(QUIET_LIVE_MS / 60_000)} min — wrapping it up`);
    // A desktop recording may still be at Recall; use it if so, otherwise
    // the write-up falls back to the live transcript.
    if (m.recallRecordingId) {
      await fetchMissingRecording(m).catch((err) => console.error(`[stuckMeetings] no recording for ${m.id} yet:`, err));
    }
    void processMeeting(m.id);
    ended++;
  }
  return { resumed, ended, failed };
}

