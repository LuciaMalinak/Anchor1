import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, dealFiles, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { saveDealFile } from "@/lib/storage";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB — documents/notes, not recordings

async function authorizeDeal(userId: string, dealId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal || !user?.teamId || deal.teamId !== user.teamId) return null;
  return deal;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const deal = await authorizeDeal(session.user.id, dealId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file selected" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File is too large (25MB max)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = await saveDealFile(dealId, file.name, buffer);

  const [dealFile] = await db
    .insert(dealFiles)
    .values({
      dealId,
      fileName: file.name,
      storagePath,
      fileSize: file.size,
      uploadedByUserId: session.user.id,
    })
    .returning();

  return NextResponse.json({ file: dealFile }, { status: 201 });
}
