import { NextResponse } from "next/server";
import { db } from "@/db";
import { dealFiles, deals } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { readStoredFile } from "@/lib/storage";
import { requireAppOwnerApi, logAdminAccess } from "@/lib/adminAccess";

// Admin-only counterpart to /api/deals/[id]/files/[fileId] — that route's
// own check (authorizeDeal) is deliberately per-teammate and would 404 for
// the app owner on someone else's team, so this is a separate, explicitly
// read-only (no DELETE here) route rather than loosening that one.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ teamId: string; dealId: string; fileId: string }> }
) {
  const admin = await requireAppOwnerApi();
  if (!admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { teamId, dealId, fileId } = await params;
  const [deal] = await db.select().from(deals).where(and(eq(deals.id, dealId), eq(deals.teamId, teamId)));
  if (!deal) {
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

  await logAdminAccess(admin.id, teamId, `deal-file:${fileId}`);

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/"/g, "")}"`,
    },
  });
}
