import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { meetings, meetingLiveSegments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { RECALL_WEBHOOK_SECRET } from "@/lib/recallWebhookSecret";
import { extractQuestion, onLiveSegment } from "@/lib/liveQuestion";

// Recall.ai calls this in real time (usually a few times a second) while
// a "send Anchor to a live meeting" bot is on a call, once a finalized
// utterance is ready — see src/lib/recall.ts's createBot() for where
// this URL gets registered per-bot and docs.recall.ai's Real-Time Event
// Payloads page for the transcript.data shape this expects.
//
// transcript.data is a finalized utterance and is stored.
// transcript.partial_data (the same utterance while it's still being
// spoken) is only checked for a question, so the answer starts before
// the speaker has even finished — see onLiveSegment in liveQuestion.ts.
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  // See the matching comment in ../route.ts — RECALL_WEBHOOK_SECRET is
  // null when the env var isn't set, and a request with no ?secret= at
  // all would otherwise also read as null and incorrectly pass.
  if (!RECALL_WEBHOOK_SECRET || secret !== RECALL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const payload = await req.json().catch(() => null);
  const event = payload?.event as string | undefined;
  const botId = payload?.data?.bot?.id as string | undefined;

  const partial = event === "transcript.partial_data";
  if ((event !== "transcript.data" && !partial) || !botId) {
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
  // Partials arrive several times a second while someone talks; only
  // ones that already contain a question are worth a database lookup.
  if (!text || (partial && !extractQuestion(text))) {
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

  const speakerName = utterance?.participant?.name || null;
  if (partial) {
    onLiveSegment(meeting.id, text, speakerName, { partial: true });
    return NextResponse.json({ ok: true, partial: true });
  }
  await db.insert(meetingLiveSegments).values({
    meetingId: meeting.id,
    speakerName,
    text,
    relativeSeconds:
      typeof relativeSeconds === "number" ? Math.round(relativeSeconds) : null,
  });

  // A question gets answered right away instead of waiting for the next
  // coaching refresh — see liveQuestion.ts. Runs after this responds.
  onLiveSegment(meeting.id, text, speakerName);

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
