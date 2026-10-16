import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveUploadPart } from "@/lib/storage";
import { MAX_PART_BYTES, MAX_PARTS, isValidUploadId } from "@/lib/chunkedUpload";

// One piece of a recording being uploaded (see src/lib/chunkedUpload.ts).
// Pieces are stored under the signed-in person, so nobody can add to or
// read someone else's upload; the route that finishes the upload joins
// them into the meeting's audio.
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const uploadId = req.nextUrl.searchParams.get("uploadId") ?? "";
  const index = Number(req.nextUrl.searchParams.get("index"));
  if (!isValidUploadId(uploadId) || !Number.isInteger(index) || index < 0 || index >= MAX_PARTS) {
    return NextResponse.json({ error: "Bad upload piece" }, { status: 400 });
  }
  const data = Buffer.from(await req.arrayBuffer());
  if (data.length === 0 || data.length > MAX_PART_BYTES) {
    return NextResponse.json({ error: "Bad upload piece size" }, { status: 400 });
  }
  await saveUploadPart(session.user.id, uploadId, index, data);
  return NextResponse.json({ ok: true });
}
