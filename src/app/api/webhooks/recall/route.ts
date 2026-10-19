import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fatalBotMessage } from "@/lib/recall";
import { processMeeting, goodLiveTranscript } from "@/lib/processMeeting";
import { ingestBotRecording } from "@/lib/botReconcile";
import { fetchMissingRecording } from "@/lib/meetingRecovery";
import { RECALL_WEBHOOK_SECRET } from "@/lib/recallWebhookSecret";

// Recall.ai calls this when a bot's recording is ready. Register this
// exact URL (including the ?secret=... below) as the webhook URL in the
// Recall.ai dashboard for whichever region RECALL_REGION points at.
//
// We don't have Recall's webhook-signing scheme verified (see
// ENGINEER_BRIEF.md), so this uses a shared-secret query param instead —
// fine for an MVP with one bot account, worth swapping for verified
// signatures before this is load-bearing for anyone but us.
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  // RECALL_WEBHOOK_SECRET is null when the env var isn't set. Rejecting
  // unconditionally in that case (rather than just `secret !== null`) is
  // deliberate — otherwise a request with NO ?secret= param at all would
  // also read as null and pass, defeating the whole check.
  if (!RECALL_WEBHOOK_SECRET || secret !== RECALL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const payload = await req.json().catch(() => null);
  const event = payload?.event as string | undefined;
  // Only trust data.bot.id as a bot id — this used to also fall back to
  // the more generic data.id, but that fallback would misfire once
  // desktop-SDK events (which have no "bot" at all) started arriving
  // through this same webhook, since their own id lives at data.id too.
  const botId = payload?.data?.bot?.id as string | undefined;
  // Desktop Recording SDK (no-bot) recordings: see the uncertainty note
  // in src/lib/recall.ts above createSdkUpload/getRecording — the exact
  // webhook event name/payload shape for these isn't 100% confirmed yet,
  // so this tries every plausible location a recording id could show up.
  const recordingId = (payload?.data?.recording?.id ??
    payload?.data?.sdk_upload?.id ??
    (!botId ? payload?.data?.id : undefined)) as string | undefined;
  const subCode = payload?.data?.data?.sub_code as string | null | undefined;

  // A bot that permanently fails to join (bad link, locked meeting,
  // expired password, etc.) never reaches "recording.done" — without
  // this, the meeting it belongs to sat at status "joining"/"recording"
  // forever, with no automatic way to know the call was never actually
  // entered. This is what left meetings stuck "live" in Anchor even
  // after the bot itself had already given up. See docs.recall.ai's
  // Bot Status Change Events / Sub Codes references (checked Sept 2026).
  if (event === "bot.fatal" && botId) {
    const [meeting] = await db.select().from(meetings).where(eq(meetings.recallBotId, botId));
    if (meeting && meeting.status !== "ready" && meeting.status !== "failed") {
      await db
        .update(meetings)
        .set({
          status: "failed",
          errorMessage: fatalBotMessage(subCode),
          updatedAt: new Date(),
        })
        .where(eq(meetings.id, meeting.id));
    }
    return NextResponse.json({ ok: true });
  }

  // Desktop-SDK (no-bot) recording finished uploading/processing. Kept as
  // a separate branch from the bot flow below since it looks the meeting
  // up by recallRecordingId instead of recallBotId, and downloads the
  // audio via getRecording/downloadRecordingAudio instead of getBot. Any
  // event name is accepted here as long as it comes with a recording id
  // we recognize and no bot id — logging the raw payload either way so
  // the real event name can be confirmed off Render's logs the first
  // time a real desktop recording completes.
  if (!botId && recordingId) {
    console.log(`[recall webhook] Desktop SDK event "${event}" for recording ${recordingId}:`, JSON.stringify(payload));
    const [meeting] = await db.select().from(meetings).where(eq(meetings.recallRecordingId, recordingId));
    if (!meeting) {
      console.error(`[recall webhook] No meeting found for recording ${recordingId}`);
      return NextResponse.json({ ok: true, warning: "unknown recording id" });
    }
    // Already has its recording.
    if (meeting.audioStoragePath) {
      return NextResponse.json({ ok: true, ignored: true });
    }
    // Otherwise take it — even when the meeting is being (or was already)
    // written up from its live transcript, or failed: the real recording
    // makes the better write-up.
    try {
      // Already written up (or being written up) from a good live
      // transcript: the recording is kept for playback, nothing to redo.
      const writtenUpLive = async () =>
        !["joining", "recording"].includes(meeting.status) && Boolean(await goodLiveTranscript(meeting.id));
      if ((await fetchMissingRecording(meeting)) && !(await writtenUpLive())) {
        await db
          .update(meetings)
          .set({ status: "uploaded", errorMessage: null, updatedAt: new Date() })
          .where(eq(meetings.id, meeting.id));
        void processMeeting(meeting.id, { rerunIfBusy: true });
      }
    } catch (err) {
      console.error(`[recall webhook] Failed to fetch desktop recording ${recordingId}:`, err);
      if (meeting.status !== "ready") {
        await db
          .update(meetings)
          .set({
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Failed to download recording",
            updatedAt: new Date(),
          })
          .where(eq(meetings.id, meeting.id));
      }
    }
    return NextResponse.json({ ok: true });
  }

  // We only care about the recording finishing. Every other event
  // (bot joining, in-call status changes, etc.) is a no-op ack.
  if (event !== "recording.done" || !botId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.recallBotId, botId));

  if (!meeting) {
    console.error(`[recall webhook] No meeting found for bot ${botId}`);
    return NextResponse.json({ ok: true, warning: "unknown bot id" });
  }

  // Same download-and-process step the status check uses, done once
  // whichever gets there first (see botReconcile.ts).
  await ingestBotRecording(meeting.id, botId);

  return NextResponse.json({ ok: true });
}
