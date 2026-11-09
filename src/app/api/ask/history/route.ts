import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { askLog, deals, meetings } from "@/db/schema";

// Ask Anchor → History: everything this person has asked, newest first,
// searchable across questions and answers. Only their own questions.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 50));
  const mine = eq(askLog.userId, session.user.id);
  const rows = await db
    .select({
      id: askLog.id,
      question: askLog.question,
      answer: askLog.answer,
      createdAt: askLog.createdAt,
      dealId: askLog.dealId,
      dealName: deals.name,
      meetingId: askLog.meetingId,
      meetingTitle: meetings.title,
    })
    .from(askLog)
    .leftJoin(deals, eq(deals.id, askLog.dealId))
    .leftJoin(meetings, eq(meetings.id, askLog.meetingId))
    .where(q ? and(mine, or(ilike(askLog.question, `%${q}%`), ilike(askLog.answer, `%${q}%`))) : mine)
    .orderBy(desc(askLog.createdAt))
    .limit(limit);
  return NextResponse.json({ items: rows });
}
