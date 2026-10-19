import { NextResponse } from "next/server";
import { and, desc, eq, gt, isNotNull, or } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, type LiveQuestionRecord } from "@/db/schema";

// The call to ask for feedback on (CallFeedbackPopup): this person's most
// recent call where Anchor helped live, once it's written up — only if
// they haven't answered or skipped it, and only for a few days. Earlier
// calls are never asked about.
const ASK_FOR_MS = 3 * 24 * 60 * 60_000;
const MAX_QUESTIONS = 6;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ meeting: null });
  const [latest] = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.userId, session.user.id),
        gt(meetings.occurredAt, new Date(Date.now() - ASK_FOR_MS)),
        or(isNotNull(meetings.liveSuggestions), isNotNull(meetings.liveQuestions))
      )
    )
    .orderBy(desc(meetings.occurredAt))
    .limit(1);
  if (!latest || latest.status !== "ready" || latest.callFeedback) return NextResponse.json({ meeting: null });
  const questions = ((latest.liveQuestions ?? []) as LiveQuestionRecord[]).slice(-MAX_QUESTIONS).reverse();
  return NextResponse.json({
    meeting: {
      id: latest.id,
      title: latest.title,
      questions: questions.map((q) => ({ askedAt: q.askedAt, question: q.question, answer: q.answer, feedback: q.feedback ?? null })),
    },
  });
}
