import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createBot } from "@/lib/recall";
import { RECALL_WEBHOOK_SECRET } from "@/lib/recallWebhookSecret";

// Same fallback used elsewhere (OAuth callbacks, etc.) — prefer the
// explicit URL when set (needed behind Render's proxy), otherwise derive
// it from the incoming request.
function baseUrl(req: NextRequest): string {
  return process.env.AUTH_URL || req.nextUrl.origin;
}

// "Send Anchor to a live meeting": the user pastes a Zoom/Meet/Teams
// link instead of uploading a file. We create the meeting row up front
// (status "joining") so it shows up in the dashboard right away, then
// ask Recall.ai to send a bot into the call. The bot's own webhook
// (/api/webhooks/recall) is what moves this meeting forward once the
// call ends and the recording is ready.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!process.env.RECALL_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Live meeting recording isn't set up yet (missing RECALL_API_KEY).",
      },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const meetingUrl = typeof body.meetingUrl === "string" ? body.meetingUrl.trim() : "";
  const titleField = typeof body.title === "string" ? body.title.trim() : "";
  const dealId = typeof body.dealId === "string" && body.dealId ? body.dealId : null;
  const scheduledAtField = typeof body.scheduledAt === "string" ? body.scheduledAt.trim() : "";

  if (!meetingUrl) {
    return NextResponse.json({ error: "Paste a meeting link first" }, { status: 400 });
  }
  try {
    new URL(meetingUrl);
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid link" }, { status: 400 });
  }

  // A blank/omitted scheduledAt means "join right now" (the original
  // behavior, unchanged). A past or unparseable value is treated the
  // same way rather than erroring — joining now is always a safe
  // fallback for a live-meeting bot.
  let scheduledAt: Date | null = null;
  if (scheduledAtField) {
    const parsed = new Date(scheduledAtField);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
      scheduledAt = parsed;
    }
  }

  const [meeting] = await db
    .insert(meetings)
    .values({
      userId: session.user.id,
      title: titleField || "Live meeting",
      status: "joining",
      dealId,
      scheduledAt,
    })
    .returning();

  try {
    const liveTranscriptWebhookUrl = `${baseUrl(req)}/api/webhooks/recall/transcript?secret=${RECALL_WEBHOOK_SECRET}`;
    const bot = await createBot(
      meetingUrl,
      liveTranscriptWebhookUrl,
      scheduledAt ? scheduledAt.toISOString() : undefined
    );
    // A meeting scheduled for later stays "joining" (with scheduledAt
    // set) until the live-transcript webhook sees the bot's first real
    // utterance and flips it to "recording" — see
    // /api/webhooks/recall/transcript. One joining right now still
    // flips immediately, same as before, since there's nothing else
    // reliable to wait on for an ad-hoc join.
    await db
      .update(meetings)
      .set({
        recallBotId: bot.id,
        status: scheduledAt ? "joining" : "recording",
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meeting.id));
  } catch (err) {
    await db
      .update(meetings)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "Failed to send bot to meeting",
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meeting.id));
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send bot to meeting" },
      { status: 502 }
    );
  }

  return NextResponse.json({ meeting }, { status: 201 });
}
