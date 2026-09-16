import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, dealFiles, meetings, summaries, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { askAnchor, type DealContext } from "@/lib/liveAssist";

const MAX_HISTORY_TURNS = 6;

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

  const body = await req.json().catch(() => ({}));
  const question = String(body.question || "").trim();
  if (!question) {
    return NextResponse.json({ error: "Ask Anchor something first." }, { status: 400 });
  }
  const rawHistory: unknown[] = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory
    .filter((h): h is { role: "user" | "assistant"; content: string } => {
      if (!h || typeof h !== "object") return false;
      const role = (h as { role?: unknown }).role;
      const content = (h as { content?: unknown }).content;
      return (role === "user" || role === "assistant") && typeof content === "string";
    })
    .slice(-MAX_HISTORY_TURNS * 2);

  const recentReady = await db
    .select({ meeting: meetings, summary: summaries })
    .from(meetings)
    .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
    .where(and(eq(meetings.dealId, dealId), eq(meetings.status, "ready")))
    .orderBy(desc(meetings.occurredAt))
    .limit(5);

  const files = await db.select().from(dealFiles).where(eq(dealFiles.dealId, dealId));

  const context: DealContext = {
    dealName: deal.name,
    continuityNote: recentReady[0]?.summary.continuityNote ?? null,
    recentMeetings: recentReady.map((r) => ({
      title: r.meeting.title,
      occurredAt: r.meeting.occurredAt.toLocaleDateString(),
      overview: r.summary.overview,
      keyPoints: r.summary.keyPoints,
      actionItems: r.summary.actionItems,
    })),
    fileNames: files.map((f) => f.fileName),
  };

  try {
    const answer = await askAnchor({ context, question, history });
    return NextResponse.json({ answer });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Anchor couldn't answer that right now." },
      { status: 502 }
    );
  }
}
