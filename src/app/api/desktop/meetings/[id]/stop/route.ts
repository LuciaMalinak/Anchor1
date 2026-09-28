import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateBearer } from "@/lib/apiToken";

// Called by the desktop app right after it tells the local Recall SDK
// to stop recording (RecallAiSdk.stopRecording — see desktop/). Unlike
// /api/meetings/[id]/stop (the bot flow, which has to actively tell
// Recall's bot to leave the call), there's nothing server-side to command
// here — the SDK already stopped capturing locally and is uploading the
// finished recording to Recall on its own. This just confirms the
// meeting is one this token owns; the meeting stays "recording" in
// Anchor's UI until Recall's completion webhook lands
// (src/app/api/webhooks/recall/route.ts) and moves it to "uploaded", same
// gap that already exists between a bot leaving a call and its
// recording.done webhook arriving.
//
// Exception: `{ failed: true }` — sent when the desktop app's own
// RecallAiSdk.startRecording() call itself threw (e.g. an invalid upload
// token), meaning no recording ever actually started and no completion
// webhook will EVER arrive to move this out of "recording". Without this,
// that meeting stays stuck "live" forever and blocks every future
// recording for the same deal via the one-live-capture guard in
// /api/desktop/meetings/start — see beginRecording() in desktop/src/main.ts,
// which calls this the moment startRecording rejects.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await authenticateBearer(req);
  if (!userId) {
    return NextResponse.json({ error: "Invalid or missing desktop token" }, { status: 401 });
  }

  const { id } = await params;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting || meeting.userId !== userId) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.failed === true) {
    const [updated] = await db
      .update(meetings)
      .set({ status: "failed" })
      .where(eq(meetings.id, id))
      .returning();
    return NextResponse.json({ ok: true, meeting: updated });
  }

  return NextResponse.json({ ok: true, meeting });
}
