import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { EXPORT_TYPES, readExport } from "@/lib/storage";

// Downloads a file Ask Anchor made for the signed-in person (an Excel
// model or a PowerPoint deck — see askTools.ts). Only their own: files
// are stored under their user id. ?name= is the file name to save as.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const ext = id.match(/^[0-9a-f-]{36}\.(xlsx|pptx)$/)?.[1];
  if (!ext) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = await readExport(session.user.id, id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const name = (req.nextUrl.searchParams.get("name") || "Anchor").replace(/[^\w .,()&-]+/g, " ").trim().slice(0, 100) || "Anchor";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": EXPORT_TYPES[ext],
      "Content-Disposition": `attachment; filename="${name.replace(/\.(xlsx|pptx)$/i, "")}.${ext}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
