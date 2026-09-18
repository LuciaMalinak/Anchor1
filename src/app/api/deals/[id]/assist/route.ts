import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { dealFiles, meetings, summaries, meetingParticipants, contacts } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { askAnchorStream, type DealContext } from "@/lib/liveAssist";
import { authorizeDeal } from "@/lib/dealAccess";
import { getDealLeadStyle } from "@/lib/styleProfile";

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

  // Independent queries — run together instead of one after another.
  // Doesn't change what's asked of the model, just how long someone
  // waits before the first token of the answer even starts generating.
  const [recentReady, files, dealContactRows, dealLeadStyle] = await Promise.all([
    db
      .select({ meeting: meetings, summary: summaries })
      .from(meetings)
      .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
      .where(and(eq(meetings.dealId, dealId), eq(meetings.status, "ready")))
      .orderBy(desc(meetings.occurredAt))
      .limit(5),
    db.select().from(dealFiles).where(eq(dealFiles.dealId, dealId)),
    // Same "people Anchor has resolved on this deal" query the handoff
    // briefing uses — includes anyone synced in from a connected CRM
    // (e.g. Salesforce) once they've appeared in a meeting on this deal.
    db
      .selectDistinctOn([contacts.id], {
        name: contacts.name,
        role: contacts.role,
        company: contacts.company,
        relationshipSummary: contacts.relationshipSummary,
      })
      .from(meetingParticipants)
      .innerJoin(meetings, eq(meetingParticipants.meetingId, meetings.id))
      .innerJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
      .where(eq(meetings.dealId, dealId)),
    // Never rebuilt synchronously here — see styleProfile.ts. A live
    // answer shouldn't wait on it; a slightly stale (or still-empty)
    // style profile is a fine trade for not adding a beat to a real-time
    // answer.
    getDealLeadStyle(deal.leadUserId, { allowSynchronousRebuild: false }),
  ]);

  const context: DealContext = {
    dealName: deal.name,
    stage: deal.stage,
    companyWebsite: deal.companyWebsite,
    memory: deal.memory,
    continuityNote: recentReady[0]?.summary.continuityNote ?? null,
    notes: deal.notes,
    decisionBoundaries: deal.decisionBoundaries,
    people: dealContactRows,
    recentMeetings: recentReady.map((r) => ({
      title: r.meeting.title,
      occurredAt: r.meeting.occurredAt.toLocaleDateString(),
      overview: r.summary.overview,
      keyPoints: r.summary.keyPoints,
      actionItems: r.summary.actionItems,
      dealSignals: r.summary.dealSignals,
    })),
    files: files.map((f) => ({ fileName: f.fileName, excerpt: f.extractedText })),
    companyResearch: deal.companyResearch,
    newsHeadline: deal.newsHeadline,
    // Already cached on the deal row (refreshed at most every 6h when the
    // deal page loads — see src/lib/dealIntegrationContext.ts), so this
    // adds zero extra latency to a live answer.
    emailContext: deal.emailContext,
    calendarContext: deal.calendarContext,
    dealLeadStyle,
  };

  // Streamed as plain text chunks rather than one JSON payload at the
  // end — the UI can start showing words the moment they're generated
  // instead of waiting for the whole answer (see askAnchorStream).
  const encoder = new TextEncoder();
  const responseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of askAnchorStream({ context, question, history })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error(`[assist] stream failed for deal ${dealId}:`, err);
        controller.enqueue(
          encoder.encode("Anchor couldn't finish answering that — try asking again.")
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
