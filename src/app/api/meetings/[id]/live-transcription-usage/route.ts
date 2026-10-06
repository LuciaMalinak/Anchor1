import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { recordAudioUsage } from "@/lib/aiUsage";

// The browser reports how long its AssemblyAI live-transcription sessions
// were open (src/lib/liveStreamingTranscription.ts) once it stops, since
// that's what AssemblyAI bills and only the browser knows it. Recorded
// for the admin page's cost view (see aiUsage.ts).

// Nothing real runs longer than this; caps a bad or repeated report.
const MAX_SECONDS = 4 * 60 * 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  const [meeting] = await db
    .select({ id: meetings.id, userId: meetings.userId })
    .from(meetings)
    .where(eq(meetings.id, id));
  if (!meeting || meeting.userId !== userId) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const seconds = typeof body.seconds === "number" && Number.isFinite(body.seconds) ? body.seconds : 0;
  recordAudioUsage({
    feature: "live_transcription",
    seconds: Math.min(Math.max(seconds, 0), MAX_SECONDS),
    userId,
    meetingId: meeting.id,
  });
  return NextResponse.json({ ok: true });
}
