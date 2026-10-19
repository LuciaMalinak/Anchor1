import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, meetings, users, type LiveQuestionRecord } from "@/db/schema";
import { authenticateBearer } from "@/lib/apiToken";
import { canAccessDeal } from "@/lib/dealAccess";
import { teachAnswer } from "@/lib/answerPlaybook";

// Thumbs up / down on a live answer (AnswerFeedback in
// LiveCoachingBits.tsx), from the website or the desktop app's overlay.
// Up keeps that answer as the team's answer to the question; down with a
// correction keeps the correction instead (answerPlaybook.ts). The rating
// is also stored on the question, so the after-call learning sees it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id ?? (await authenticateBearer(req));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  const [deal] = meeting.dealId ? await db.select().from(deals).where(eq(deals.id, meeting.dealId)) : [];
  const allowed = meeting.userId === userId || (deal ? await canAccessDeal(userId, deal.id, deal.teamId, deal) : false);
  if (!allowed) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const askedAt = Number(body.askedAt);
  const rating = body.rating === "up" || body.rating === "down" ? body.rating : null;
  const correction = typeof body.correction === "string" ? body.correction.trim().slice(0, 2000) : "";
  if (!Number.isFinite(askedAt) || !rating) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const list = (meeting.liveQuestions ?? []) as LiveQuestionRecord[];
  const record = list.find((q) => q.askedAt === askedAt);
  if (!record) return NextResponse.json({ error: "That answer isn't saved yet — try again in a moment." }, { status: 409 });

  await db
    .update(meetings)
    .set({
      liveQuestions: list.map((q) =>
        q.askedAt === askedAt ? { ...q, feedback: rating, ...(correction ? { correction } : {}) } : q
      ),
    })
    .where(eq(meetings.id, id));

  const teamId = deal?.teamId ?? (await db.select({ teamId: users.teamId }).from(users).where(eq(users.id, meeting.userId)))[0]?.teamId;
  const answer = rating === "up" ? record.answer : correction;
  if (teamId && answer) {
    await teachAnswer({ teamId, dealId: null, question: record.question, answer, userId, meetingId: id });
  }
  return NextResponse.json({ ok: true });
}
