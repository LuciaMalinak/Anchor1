import { NextRequest, NextResponse, after } from "next/server";
import { reconcileBotMeeting } from "@/lib/botReconcile";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { deleteUploadParts, joinUploadParts, saveMeetingAudio } from "@/lib/storage";
import { MAX_PARTS, isValidUploadId } from "@/lib/chunkedUpload";
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

  // Home polls this while a call is live: also catch a bot call up with
  // Recall if its "recording done" webhook never came (botReconcile.ts).
  const live = rows.filter((m) => m.recallBotId && (m.status === "joining" || m.status === "recording"));
  if (live.length) after(async () => {
    for (const m of live) await reconcileBotMeeting(m);
  });

  return NextResponse.json({ meetings: rows });
}

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Either a form with the file itself, or JSON naming the pieces it was
  // uploaded in (src/lib/chunkedUpload.ts), which big files now use.
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  const json = isJson ? await req.json().catch(() => ({})) : null;
  const formData = isJson ? null : await req.formData();
  const titleField = json ? json.title : formData!.get("title");
  const title = typeof titleField === "string" ? titleField.trim() : "";
  const dealIdField = json ? json.dealId : formData!.get("dealId");
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

  let fileName: string;
  let buffer: Buffer;
  let pieces: string | null = null;
  if (json) {
    const uploadId = typeof json.uploadId === "string" ? json.uploadId : "";
    const parts = Number(json.parts);
    if (!isValidUploadId(uploadId) || !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) {
      return NextResponse.json({ error: "Bad upload" }, { status: 400 });
    }
    // Keep the person's file name, minus anything that isn't safe in a path.
    fileName = typeof json.fileName === "string" ? json.fileName.replace(/[^\w. ()-]/g, "_").slice(-120) || "recording" : "recording";
    const joined = await joinUploadParts(session.user.id, uploadId, parts);
    if (!joined) return NextResponse.json({ error: "Some of the file didn't arrive — try again." }, { status: 400 });
    buffer = joined;
    pieces = uploadId;
  } else {
    const file = formData!.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    fileName = file.name;
    buffer = Buffer.from(await file.arrayBuffer());
  }
  if (buffer.length === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File is too large (500MB max for the MVP)" },
      { status: 400 }
    );
  }

  const [meeting] = await db
    .insert(meetings)
    .values({
      userId: session.user.id,
      title: title || fileName.replace(/\.[^/.]+$/, ""),
      audioFileName: fileName,
      status: "uploaded",
      dealId,
    })
    .returning();

  const storagePath = await saveMeetingAudio(meeting.id, fileName, buffer);
  if (pieces) await deleteUploadParts(session.user.id, pieces);

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
