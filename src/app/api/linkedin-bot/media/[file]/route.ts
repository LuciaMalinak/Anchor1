import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { linkedinBotItems } from "@/db/schema";
import { parseMediaFile } from "@/lib/linkedinBot/media";
import { renderCoverImage, renderSlideVideo } from "@/lib/linkedinBot/video";
import type { Slide } from "@/lib/linkedinBot/write";

// The weekly video (.mp4) and its cover (.png), opened by Zapier when it
// posts. No sign-in: the signed file name is the key (media.ts), and only
// the bot's own videos are served.
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const parsed = parseMediaFile((await params).file);
  if (!parsed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [item] = await db.select().from(linkedinBotItems).where(eq(linkedinBotItems.id, parsed.id));
  const slides = ((item?.extra ?? {}) as { slides?: Slide[] }).slides;
  if (!item || item.kind !== "video" || item.status === "skipped" || !slides?.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const data = parsed.ext === "mp4" ? await renderSlideVideo(slides) : await renderCoverImage(slides);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": parsed.ext === "mp4" ? "video/mp4" : "image/png",
      "Content-Length": String(data.length),
      "Content-Disposition": `inline; filename="ai-anchor-video.${parsed.ext}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export const maxDuration = 120;
