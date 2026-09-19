import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { saveMeetingAudio } from "@/lib/storage";
import { processMeeting } from "@/lib/processMeeting";
import { authorizeDeal } from "@/lib/dealAccess";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(meetings)
    .where(eq(meetings.userId, session.user.id))
    .orderBy(desc(meetings.createdAt));

  return NextResponse.json({ meetings: rows });
}

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const titleField = formData.get("title");
  const title = typeof titleField === "string" ? titleField.trim() : "";
  const dealIdField = formData.get("dealId");
  const dealId = typeof dealIdField === "string" && dealIdField ? dealIdField : null;

  // A meeting's dealId used to be trusted with no check at all — anyone
  // could attach their own meeting to ANY team's deal by UUID, and
  // several other routes (follow-up drafts, live coaching, the home
  // page task/feed lists) then trusted that dealId and leaked the real
  // deal's data back out. Verifying it belongs to a deal this user can
  // actually see closes that off at the one place it needs to happen.
  if (dealId && !(await authorizeDeal(session.user.id, dealId))) {
    return NextResponse.json({ error: "That deal wasn't found" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File is too large (500MB max for the MVP)" },
      { status: 400 }
    );
  }

  const [meeting] = await db
    .insert(meetings)
    .values({
      userId: session.user.id,
      title: title || file.name.replace(/\.[^/.]+$/, ""),
      audioFileName: file.name,
      status: "uploaded",
      dealId,
    })
    .returning();

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = await saveMeetingAudio(meeting.id, file.name, buffer);

  await db
    .update(meetings)
    .set({ audioStoragePath: storagePath })
    .where(eq(meetings.id, meeting.id));

  // Fire and forget — the client polls GET /api/meetings/[id] for status.
  // See the note in processMeeting.ts about why this should become a real
  // job queue before this goes beyond a handful of design partners.
  void processMeeting(meeting.id);

  return NextResponse.json({ meeting }, { status: 201 });
}
