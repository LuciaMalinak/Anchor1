import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, meetings, summaries, dealFiles, dealMessages, users, meetingParticipants, contacts, teams } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { researchCompany, isResearchStale } from "@/lib/companyResearch";
import { getDailyBriefing, isBriefingStale } from "@/lib/dailyBriefing";
import { DealTabs } from "./DealTabs";

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();

  const teamId = await getOrCreateTeamId(session.user.id);
  let [deal] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, id), eq(deals.teamId, teamId)));
  if (!deal) notFound();

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

  // Same throttled, best-effort pattern for the team-wide (not
  // deal-specific) "Today's briefing" — shared across every deal so it's
  // only fetched once a day per team, not once per deal view.
  let [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (team && isBriefingStale(team.dailyBriefingUpdatedAt)) {
    try {
      const dailyBriefing = await getDailyBriefing();
      const dailyBriefingUpdatedAt = new Date();
      await db.update(teams).set({ dailyBriefing, dailyBriefingUpdatedAt }).where(eq(teams.id, teamId));
      team = { ...team, dailyBriefing, dailyBriefingUpdatedAt };
    } catch (err) {
      console.error("Background daily briefing refresh failed:", err);
    }
  }

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

  return (
    <DealTabs
      deal={{
        id: deal.id,
        name: deal.name,
        stage: deal.stage,
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
      }}
      people={dealContactRows}
      team={teammates.map((t) => ({ id: t.id, name: t.name, email: t.email, title: t.title, image: t.image }))}
      meetings={dealMeetings.map((m) => ({
        id: m.id,
        title: m.title,
        status: m.status,
        occurredAt: m.occurredAt.toISOString(),
        errorMessage: m.errorMessage,
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
      }))}
      teamSize={teammates.length}
      dailyBriefing={team?.dailyBriefing ?? null}
      dailyBriefingUpdatedAt={team?.dailyBriefingUpdatedAt ? team.dailyBriefingUpdatedAt.toISOString() : null}
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
