import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, meetings, summaries, dealFiles, dealMessages, users, meetingParticipants, contacts } from "@/db/schema";
import { asc, desc, eq } from "drizzle-orm";
import { authorizeDeal } from "@/lib/dealAccess";
import { researchCompany, isResearchStale } from "@/lib/companyResearch";
import { refreshDealIntegrationContext, isIntegrationContextStale } from "@/lib/dealIntegrationContext";
import { computeDealHealth } from "@/lib/dealHealth";
import { DealTabs } from "./DealTabs";

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();

  const authorized = await authorizeDeal(session.user.id, id);
  if (!authorized) notFound();
  const { teamId } = authorized;
  let deal = authorized.deal;

  // Best-effort, throttled auto-refresh: if this deal has a company
  // website and its research is missing or more than a day old, quietly
  // look it up now so the News callout and research box are current
  // without anyone having to click "Research company" first. Never
  // blocks the page on failure — same pattern as the deal-memory update
  // in processMeeting.ts.
  if (deal.companyWebsite && isResearchStale(deal.companyResearchUpdatedAt)) {
    try {
      const result = await researchCompany({
        companyName: deal.name,
        companyWebsite: deal.companyWebsite,
      });
      const companyResearchUpdatedAt = new Date();
      await db
        .update(deals)
        .set({
          companyResearch: result.briefing,
          newsHeadline: result.newsHeadline,
          companyResearchUpdatedAt,
        })
        .where(eq(deals.id, id));
      deal = {
        ...deal,
        companyResearch: result.briefing,
        newsHeadline: result.newsHeadline,
        companyResearchUpdatedAt,
      };
    } catch (err) {
      console.error("Background company research failed:", err);
    }
  }

  // Same best-effort, throttled idea, for whatever Gmail/Calendar
  // activity is happening with this deal's contacts — see
  // src/lib/dealIntegrationContext.ts for why it uses the deal's lead
  // (or creator)'s connection rather than whoever's viewing the page.
  if (isIntegrationContextStale(deal.integrationContextUpdatedAt)) {
    const refreshed = await refreshDealIntegrationContext({
      id: deal.id,
      leadUserId: deal.leadUserId,
      createdByUserId: deal.createdByUserId,
      primaryContactEmail: deal.primaryContactEmail,
    });
    if (refreshed) {
      deal = {
        ...deal,
        emailContext: refreshed.emailContext,
        calendarContext: refreshed.calendarContext,
        integrationContextUpdatedAt: new Date(),
      };
    }
  }

  // The team-wide "Today's briefing" now lives in the shared dashboard
  // layout (GeneralNewsSidebar), not here — this page's sidebar is
  // deal-specific news only.

  const dealMeetings = await db
    .select()
    .from(meetings)
    .where(eq(meetings.dealId, id))
    .orderBy(desc(meetings.occurredAt));

  const readyIds = dealMeetings.filter((m) => m.status === "ready").map((m) => m.id);
  // Fetch every ready meeting's summary (small N for an MVP — fine as
  // sequential lookups rather than an IN() query).
  const allSummaries = await Promise.all(
    readyIds.map((mid) => db.select().from(summaries).where(eq(summaries.meetingId, mid)))
  );
  const summaryByMeetingId = new Map(
    readyIds.map((mid, i) => [mid, allSummaries[i][0]] as const)
  );

  const files = await db
    .select()
    .from(dealFiles)
    .where(eq(dealFiles.dealId, id))
    .orderBy(desc(dealFiles.createdAt));

  const teammates = await db.select().from(users).where(eq(users.teamId, teamId));

  // The people Anchor has resolved as speakers across this deal's
  // meetings — a lightweight "who's involved on their side" view. Scoped
  // to this account's own contacts (contacts aren't team-shared yet).
  const dealContactRows = await db
    .selectDistinctOn([contacts.id], {
      id: contacts.id,
      name: contacts.name,
      company: contacts.company,
      role: contacts.role,
      relationshipSummary: contacts.relationshipSummary,
      meetingCount: contacts.meetingCount,
    })
    .from(meetingParticipants)
    .innerJoin(meetings, eq(meetingParticipants.meetingId, meetings.id))
    .innerJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
    .where(eq(meetings.dealId, id));

  const messageRows = await db
    .select({ message: dealMessages, author: users })
    .from(dealMessages)
    .innerJoin(users, eq(dealMessages.userId, users.id))
    .where(eq(dealMessages.dealId, id))
    .orderBy(asc(dealMessages.createdAt));

  const lastActivityAt = dealMeetings[0]?.occurredAt ?? null;
  const health = computeDealHealth({
    stage: deal.stage,
    lastActivityAt,
    createdAt: deal.createdAt,
  });

  return (
    <DealTabs
      deal={{
        id: deal.id,
        name: deal.name,
        stage: deal.stage,
        health,
        primaryContactName: deal.primaryContactName,
        primaryContactRole: deal.primaryContactRole,
        primaryContactEmail: deal.primaryContactEmail,
        companyWebsite: deal.companyWebsite,
        memory: deal.memory,
        notes: deal.notes,
        companyResearch: deal.companyResearch,
        companyResearchUpdatedAt: deal.companyResearchUpdatedAt
          ? deal.companyResearchUpdatedAt.toISOString()
          : null,
        newsHeadline: deal.newsHeadline,
        decisionBoundaries: deal.decisionBoundaries,
        leadUserId: deal.leadUserId,
        backupUserId: deal.backupUserId,
      }}
      people={dealContactRows}
      team={teammates.map((t) => ({ id: t.id, name: t.name, email: t.email, title: t.title, image: t.image }))}
      meetings={dealMeetings.map((m) => ({
        id: m.id,
        title: m.title,
        status: m.status,
        occurredAt: m.occurredAt.toISOString(),
        errorMessage: m.errorMessage,
        scheduledAt: m.scheduledAt ? m.scheduledAt.toISOString() : null,
        summary: summaryByMeetingId.get(m.id)
          ? {
              overview: summaryByMeetingId.get(m.id)!.overview,
              keyPoints: summaryByMeetingId.get(m.id)!.keyPoints,
              actionItems: summaryByMeetingId.get(m.id)!.actionItems,
              continuityNote: summaryByMeetingId.get(m.id)!.continuityNote,
            }
          : null,
      }))}
      files={files.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        fileSize: f.fileSize,
        createdAt: f.createdAt.toISOString(),
        readableByAI: Boolean(f.extractedText),
      }))}
      teamSize={teammates.length}
      messages={messageRows.map((r) => ({
        id: r.message.id,
        content: r.message.content,
        createdAt: r.message.createdAt.toISOString(),
        author: { id: r.author.id, name: r.author.name, email: r.author.email, image: r.author.image },
      }))}
      currentUserId={session.user.id}
    />
  );
}
