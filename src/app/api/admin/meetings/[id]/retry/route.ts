import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { adminRetryMeeting } from "@/lib/adminMeetingActions";

// App owner only: re-run a failed meeting (see adminMeetingActions.ts).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAppOwnerApi();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting)
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (meeting.status !== "failed")
    return NextResponse.json({ error: "Only failed meetings can be retried." }, { status: 400 });
  if (!meeting.audioStoragePath && meeting.errorMessage === "No audio file on this meeting")
    return NextResponse.json({ error: "No audio was ever saved for this meeting, so there's nothing to retry." }, { status: 400 });
  const note = await adminRetryMeeting(admin.id, meeting);
  return NextResponse.json({ ok: true, note });
}
