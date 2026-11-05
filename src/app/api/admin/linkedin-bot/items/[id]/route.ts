import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { linkedinBotItems } from "@/db/schema";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { postItemNow } from "@/lib/linkedinBot/run";

// Edit, reschedule, skip or post one of the bot's items; mark a comment
// draft done once it's been posted by hand.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAppOwnerApi())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: "edit" | "skip" | "post" | "schedule" | "done" | "restore";
    text?: string;
    at?: string;
  };
  const editable = inArray(linkedinBotItems.status, ["scheduled", "failed", "draft", "skipped"]);
  let row;
  switch (body.action) {
    case "edit": {
      const text = (body.text ?? "").trim();
      if (!text || text.length > 3000) return NextResponse.json({ error: "Posts must be 1–3,000 characters." }, { status: 400 });
      [row] = await db.update(linkedinBotItems).set({ text }).where(and(eq(linkedinBotItems.id, id), editable)).returning();
      break;
    }
    case "schedule": {
      const at = body.at ? new Date(body.at) : null;
      if (!at || Number.isNaN(at.getTime())) return NextResponse.json({ error: "Pick a time." }, { status: 400 });
      [row] = await db
        .update(linkedinBotItems)
        .set({ scheduledFor: at, status: "scheduled", error: null, attempts: 0 })
        .where(and(eq(linkedinBotItems.id, id), inArray(linkedinBotItems.kind, ["post", "video"]), editable))
        .returning();
      break;
    }
    case "skip":
      [row] = await db.update(linkedinBotItems).set({ status: "skipped" }).where(and(eq(linkedinBotItems.id, id), editable)).returning();
      break;
    case "restore":
      [row] = await db
        .update(linkedinBotItems)
        .set({ status: "scheduled", error: null, attempts: 0 })
        .where(and(eq(linkedinBotItems.id, id), eq(linkedinBotItems.status, "skipped"), inArray(linkedinBotItems.kind, ["post", "video"])))
        .returning();
      break;
    case "done":
      [row] = await db
        .update(linkedinBotItems)
        .set({ status: "done", text: (body.text ?? "").trim() || undefined, postedAt: new Date() })
        .where(and(eq(linkedinBotItems.id, id), eq(linkedinBotItems.kind, "comment")))
        .returning();
      break;
    case "post":
      row = await postItemNow(id);
      if (!row) return NextResponse.json({ error: "That item can't be posted now." }, { status: 409 });
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item: row });
}

export const maxDuration = 300;
