import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { meetings, meetingLiveSegments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { RECALL_WEBHOOK_SECRET } from "@/lib/recallWebhookSecret";

// Recall.ai calls this in real time (usually a few times a second) while
// a "send Anchor to a live meeting" bot is on a call, once a finalized
// utterance is ready — see src/lib/recall.ts's createBot() for where
// this URL gets registered per-bot and docs.recall.ai's Real-Time Event
// Payloads page for the transcript.data shape this expects.
//
// Only transcript.data (finalized utterances) is requested — we don't
// subscribe to transcript.partial_data, since partials would mean
// rewriting/dedup logic here for not much benefit to a coaching panel
// that already re-summarizes every ~20s.
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== RECALL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const payload = await req.json().catch(() => null);
  const event = payload?.event as string | undefined;
  const botId = payload?.data?.bot?.id as string | undefined;

  if (event !== "transcript.data" || !botId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const utterance = payload?.data?.data as
    | {
        words?: { text?: string; start_timestamp?: { relative?: number } }[];
        participant?: { name?: string | null };
      }
    | undefined;

  const text = (utterance?.words || [])
    .map((w) => w.text || "")
    .join(" ")
    .trim();
  if (!text) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const [meeting] = await db
    .select({ id: meetings.id, status: meetings.status })
    .from(meetings)
    .where(eq(meetings.recallBotId, botId));

  if (!meeting) {
    // Not an error — the meeting row may not have recallBotId set yet
    // if this arrives in the brief window right after createBot()
    // resolves but before we've saved the id. Safe to drop; the live
    // panel just starts a beat later.
    return NextResponse.json({ ok: true, warning: "unknown bot id" });
  }

  const relativeSeconds = utterance?.words?.[0]?.start_timestamp?.relative;

  await db.insert(meetingLiveSegments).values({
    meetingId: meeting.id,
    speakerName: utterance?.participant?.name || null,
    text,
    relativeSeconds:
      typeof relativeSeconds === "number" ? Math.round(relativeSeconds) : null,
  });

  // First real speech is the most reliable signal we have that a bot
  // scheduled for later (see /api/meetings/join) has actually joined and
  // is now capturing the call — flip it out of "joining" here rather
  // than needing a separate bot-status webhook subscription. A no-op
  // once the meeting's already "recording".
  if (meeting.status === "joining") {
    await db
      .update(meetings)
      .set({ status: "recording", updatedAt: new Date() })
      .where(eq(meetings.id, meeting.id));
  }

  return NextResponse.json({ ok: true });
}
