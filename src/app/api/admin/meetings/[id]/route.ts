import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { adminDeleteMeeting } from "@/lib/adminMeetingActions";

// App owner only: permanently delete any meeting (see adminMeetingActions.ts).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAppOwnerApi();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting)
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  await adminDeleteMeeting(admin.id, meeting);
  return NextResponse.json({ ok: true });
}
