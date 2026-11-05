import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { linkedinBotItems } from "@/db/schema";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { renderSlideVideo } from "@/lib/linkedinBot/video";
import type { Slide } from "@/lib/linkedinBot/write";

// Preview of a weekly video, rendered the same way it will be posted.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAppOwnerApi())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const [item] = await db.select().from(linkedinBotItems).where(eq(linkedinBotItems.id, id));
  const slides = ((item?.extra ?? {}) as { slides?: Slide[] }).slides;
  if (!item || item.kind !== "video" || !slides?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const mp4 = await renderSlideVideo(slides);
  return new NextResponse(new Uint8Array(mp4), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(mp4.length),
      "Cache-Control": "private, no-store",
      ...(new URL(req.url).searchParams.has("download")
        ? { "Content-Disposition": 'attachment; filename="ai-anchor-video.mp4"' }
        : {}),
    },
  });
}

export const maxDuration = 120;
