import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, type CallFeedback } from "@/db/schema";

// Saves the after-call feedback (or that it was skipped), so it isn't
// asked again. A note is passed to Anchor's live help on later calls.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const [meeting] = await db.select({ userId: meetings.userId }).from(meetings).where(eq(meetings.id, id));
  if (!meeting || meeting.userId !== session.user.id) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const feedback: CallFeedback = { at: Date.now() };
  if (body.skipped === true) feedback.skipped = true;
  if (body.rating === "up" || body.rating === "down") feedback.rating = body.rating;
  if (typeof body.note === "string" && body.note.trim()) feedback.note = body.note.trim().slice(0, 1000);
  await db.update(meetings).set({ callFeedback: feedback }).where(eq(meetings.id, id));
  return NextResponse.json({ ok: true });
}
