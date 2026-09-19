import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, meetings, summaries, dealFiles, dealMessages, users, meetingParticipants, contacts, dealMembers } from "@/db/schema";
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

  // Best-effort, throttled auto-refresh: if this deal's research is
  // missing or stale, quietly look it up now so the News callout and
  // research box are current without anyone having to click "Research
  // company" first. researchCompany() falls back to just the company
  // name when there's no website on file, so this no longer requires
  // one — deals without a website were silently never auto-researched
  // even though the manual "Research" button worked fine for them (it
  // never had this gate).
  //
  // Fired in the background rather than awaited — this used to block the
  // whole page render on a web-search call, which meant opening ANY deal
  // with no/stale research (true for every newly created deal) froze the
  // page for several seconds. The page now renders immediately with
  // whatever's cached (nothing, for a brand-new deal), and the "Research"
  // panel in DealTabs polls for the result once this finishes — same
  // pattern used for the dashboard's daily briefing.
  if (isResearchStale(deal.companyResearchUpdatedAt)) {
    const dealId = id;
    const { name: companyName, companyWebsite } = deal;
    researchCompany({ companyName, companyWebsite })
      .then((result) =>
        db
          .update(deals)
          .set({
            companyResearch: result.briefing,
            newsHeadline: result.newsHeadline,
            companyResearchUpdatedAt: new Date(),
          })
          .where(eq(deals.id, dealId))
      )
      .catch((err) => console.error("Background company research failed:", err));
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
  // Same visibility rule as GET /api/deals/[id]/messages (see that
  // route's visibleTo comment) — this page fetches messages directly
  // rather than through the API, so it needs its own copy of the filter.
  const visibleMessageRows = messageRows.filter((r) => {
    const rids = r.message.recipientUserIds;
    return !rids || r.message.userId === session.user.id || rids.includes(session.user.id);
  });

  // Who this restricted deal (if it is one) has been explicitly shared
  // with — used to pre-fill the sharing picker and the chat's recipient
  // picker. Harmless to compute even when the deal isn't restricted.
  const memberRows = await db.select({ userId: dealMembers.userId }).from(dealMembers).where(eq(dealMembers.dealId, id));
  const sharedWithUserIds = memberRows.map((r) => r.userId);

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
        restricted: deal.restricted,
      }}
      sharedWithUserIds={sharedWithUserIds}
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
      messages={visibleMessageRows.map((r) => ({
        id: r.message.id,
        content: r.message.content,
        createdAt: r.message.createdAt.toISOString(),
        author: { id: r.author.id, name: r.author.name, email: r.author.email, image: r.author.image },
        recipientUserIds: r.message.recipientUserIds,
      }))}
      currentUserId={session.user.id}
    />
  );
}
