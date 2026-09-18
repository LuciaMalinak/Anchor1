import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { dealFiles, meetings, summaries, meetingParticipants, contacts } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { askAnchor, type DealContext } from "@/lib/liveAssist";
import { authorizeDeal } from "@/lib/dealAccess";

const MAX_HISTORY_TURNS = 6;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const authorized = await authorizeDeal(session.user.id, dealId);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const { deal } = authorized;

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

  // Same "people Anchor has resolved on this deal" query the handoff
  // briefing uses — includes anyone synced in from a connected CRM (e.g.
  // Salesforce) once they've appeared in a meeting on this deal.
  const dealContactRows = await db
    .selectDistinctOn([contacts.id], {
      name: contacts.name,
      role: contacts.role,
      company: contacts.company,
      relationshipSummary: contacts.relationshipSummary,
    })
    .from(meetingParticipants)
    .innerJoin(meetings, eq(meetingParticipants.meetingId, meetings.id))
    .innerJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
    .where(eq(meetings.dealId, dealId));

  const context: DealContext = {
    dealName: deal.name,
    stage: deal.stage,
    companyWebsite: deal.companyWebsite,
    memory: deal.memory,
    continuityNote: recentReady[0]?.summary.continuityNote ?? null,
    people: dealContactRows,
    recentMeetings: recentReady.map((r) => ({
      title: r.meeting.title,
      occurredAt: r.meeting.occurredAt.toLocaleDateString(),
      overview: r.summary.overview,
      keyPoints: r.summary.keyPoints,
      actionItems: r.summary.actionItems,
    })),
    files: files.map((f) => ({ fileName: f.fileName, excerpt: f.extractedText })),
    companyResearch: deal.companyResearch,
    newsHeadline: deal.newsHeadline,
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
