import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, meetingLiveSegments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateBearer } from "@/lib/apiToken";

// Appends one finalized utterance to a meeting's live transcript, from
// the browser's own live speech-to-text running during an in-person
// recording (see useMicRecorder in src/components/MicRecorder.tsx) — the
// session-authenticated equivalent of what Recall.ai's transcript
// webhook does for a bot-joined call
// (src/app/api/webhooks/recall/transcript/route.ts). Feeding the same
// meeting_live_segment table is what makes the During tab's live panel,
// the Focus window, and live coaching all work for an in-person meeting
// exactly the way they already do for Zoom/Teams — none of that code
// cares where a segment came from. Also accepts the desktop app's bearer
// token (src/lib/apiToken.ts) instead of a session cookie, so it can
// forward whatever real-time transcript events Recall's Desktop SDK
// delivers to it the same way.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const bearerUserId = session?.user?.id ? null : await authenticateBearer(req);
  const userId = session?.user?.id ?? bearerUserId;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const [meeting] = await db
    .select({ id: meetings.id, userId: meetings.userId, status: meetings.status })
    .from(meetings)
    .where(eq(meetings.id, id));
  if (!meeting || meeting.userId !== userId) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  if (meeting.status !== "recording" && meeting.status !== "joining") {
    // Recording already stopped — a late/straggling speech-recognition
    // result arriving just after Stop. Dropped rather than errored;
    // there's nothing useful left to do with it at this point.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "No text" }, { status: 400 });
  }

  await db.insert(meetingLiveSegments).values({
    meetingId: meeting.id,
    text,
  });

  return NextResponse.json({ ok: true });
}
