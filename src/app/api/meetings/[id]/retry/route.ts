import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { retryMeeting } from "@/lib/meetingRecovery";

// "Try again" on a meeting that failed to process (owner only).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const [meeting] = await db.select().from(meetings).where(and(eq(meetings.id, id), eq(meetings.userId, session.user.id)));
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (meeting.status !== "failed") return NextResponse.json({ error: "This meeting isn't failed." }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await retryMeeting(meeting)) });
}

export const maxDuration = 120;
