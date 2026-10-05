import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, transcripts, summaries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { saveMeetingAudio } from "@/lib/storage";
import { processMeeting } from "@/lib/processMeeting";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB — same cap as a manual upload.

// Attaches the actual recorded audio to a meeting that was already
// created live when an in-person recording started (see
// /api/meetings/mic/start) — the equivalent of what the Recall.ai
// webhook does once a bot-joined call's recording is ready
// (src/app/api/webhooks/recall/route.ts), just triggered here by
// clicking Stop instead of an external webhook. From here on this
// meeting joins the exact same uploaded -> transcribing -> summarizing
// -> ready pipeline a plain file upload goes through.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting || meeting.userId !== session.user.id) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  const live = meeting.status === "recording" || meeting.status === "joining";
  // An in-person recording that failed before its audio was ever stored —
  // a storage error on the first attempt below, or it was wrapped up from
  // the live transcript and that failed — still takes its real audio, so
  // "Retry upload" in the browser can actually recover it. Before this,
  // the first failure marked the meeting "failed" and every retry after
  // it was rejected here as "already finished".
  const recoverable =
    meeting.status === "failed" &&
    !meeting.audioStoragePath &&
    !meeting.recallBotId &&
    !meeting.recallRecordingId;
  if (!live && !recoverable) {
    return NextResponse.json({ error: "This recording was already finished." }, { status: 400 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Nothing was recorded — try again." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Recording is too large (500MB max for the MVP)" },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = await saveMeetingAudio(meeting.id, file.name, buffer);
    if (recoverable) {
      // Whatever a failed live-transcript write-up left behind, so the
      // real recording's transcript and summary don't sit next to it.
      await db.delete(summaries).where(eq(summaries.meetingId, meeting.id));
      await db.delete(transcripts).where(eq(transcripts.meetingId, meeting.id));
    }
    await db
      .update(meetings)
      .set({
        audioFileName: file.name,
        audioStoragePath: storagePath,
        status: "uploaded",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meeting.id));
  } catch (err) {
    await db
      .update(meetings)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "Couldn't save this recording",
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meeting.id));
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't save this recording" },
      { status: 502 }
    );
  }

  // Fire and forget — same pattern as a manual upload and the Recall
  // webhook; the client polls for status instead of waiting here.
  void processMeeting(meeting.id);

  return NextResponse.json({ ok: true, meetingId: meeting.id });
}
