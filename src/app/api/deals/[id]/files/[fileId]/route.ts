import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, dealFiles, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { readStoredFile } from "@/lib/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId, fileId } = await params;
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal || !user?.teamId || deal.teamId !== user.teamId) {
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
