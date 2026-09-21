import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { downloadBotAudio, fatalBotMessage } from "@/lib/recall";
import { saveMeetingAudio } from "@/lib/storage";
import { processMeeting } from "@/lib/processMeeting";
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
  if (secret !== RECALL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const payload = await req.json().catch(() => null);
  const event = payload?.event as string | undefined;
  const botId = (payload?.data?.bot?.id ?? payload?.data?.id) as string | undefined;
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

  try {
    const audio = await downloadBotAudio(botId);
    const fileName = `${botId}.mp4`;
    const storagePath = await saveMeetingAudio(meeting.id, fileName, audio);

    await db
      .update(meetings)
      .set({
        audioFileName: fileName,
        audioStoragePath: storagePath,
        status: "uploaded",
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meeting.id));

    // Same fire-and-forget pattern as a manual upload — see the note in
    // processMeeting.ts.
    void processMeeting(meeting.id);
  } catch (err) {
    console.error(`[recall webhook] Failed to fetch recording for bot ${botId}:`, err);
    await db
      .update(meetings)
      .set({
        status: "failed",
        errorMessage:
          err instanceof Error ? err.message : "Failed to download recording",
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meeting.id));
  }

  return NextResponse.json({ ok: true });
}
