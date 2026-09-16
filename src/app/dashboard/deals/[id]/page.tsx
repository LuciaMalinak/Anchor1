import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, meetings, summaries, dealFiles, users, meetingParticipants, contacts } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
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
  const [deal] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, id), eq(deals.teamId, teamId)));
  if (!deal) notFound();

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
    />
  );
}
