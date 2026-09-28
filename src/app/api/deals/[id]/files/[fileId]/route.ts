import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { dealFiles } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { readStoredFile, deleteDealFile } from "@/lib/storage";
import { authorizeDeal } from "@/lib/dealAccess";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId, fileId } = await params;
  const authorized = await authorizeDeal(session.user.id, dealId);
  if (!authorized) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [file] = await db
    .select()
    .from(dealFiles)
    .where(and(eq(dealFiles.id, fileId), eq(dealFiles.dealId, dealId)));
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = await readStoredFile(file.storagePath);
  if (!data) {
    return NextResponse.json({ error: "File is missing from storage" }, { status: 410 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/"/g, "")}"`,
    },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId, fileId } = await params;
  const authorized = await authorizeDeal(session.user.id, dealId);
  if (!authorized) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [file] = await db
    .select()
    .from(dealFiles)
    .where(and(eq(dealFiles.id, fileId), eq(dealFiles.dealId, dealId)));
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await deleteDealFile(file.storagePath);
  await db.delete(dealFiles).where(eq(dealFiles.id, fileId));

  return NextResponse.json({ ok: true });
}
