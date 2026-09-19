import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, users, deals, teams, announcements } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getOrCreateTeamId } from "@/lib/team";
import { getHomeUpdates } from "@/lib/homeFeed";
import { getHomeTasks } from "@/lib/homeTasks";
import { isIndustryKey } from "@/lib/industries";
import { AttentionPanel } from "./AttentionPanel";
import { AnnouncementsPanel } from "./AnnouncementsPanel";
import { DashboardClient } from "./DashboardClient";
import { HomeTasks } from "./HomeTasks";
import { HomeUpdates } from "./HomeUpdates";
import { WelcomeGate } from "./WelcomeGate";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ setIndustry?: string }>;
}) {
  const session = await auth();
  const { setIndustry } = await searchParams;
  const rows = session?.user?.id
    ? await db
        .select()
        .from(meetings)
        .where(eq(meetings.userId, session.user.id))
        .orderBy(desc(meetings.createdAt))
    : [];

  const serializable = rows.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    errorMessage: m.errorMessage,
    createdAt: m.createdAt.toISOString(),
  }));

  const teamId = session?.user?.id ? await getOrCreateTeamId(session.user.id) : null;

  // A visitor who clicked an industry link on the homepage or footer
  // carries ?setIndustry=... through sign-in into here. Apply it once,
  // only for a fresh team that hasn't picked an industry yet, and only
  // if this user owns the team — then strip the param either way so a
  // refresh or share of the URL can't reapply/override it later.
  if (teamId && session?.user?.id && setIndustry && isIndustryKey(setIndustry)) {
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    if (team && team.ownerUserId === session.user.id && !team.industry) {
      await db.update(teams).set({ industry: setIndustry }).where(eq(teams.id, teamId));
    }
    redirect("/dashboard");
  }

  let welcomeSeen = true;
  let homeUpdates: Awaited<ReturnType<typeof getHomeUpdates>> = [];
  let homeTasks: Awaited<ReturnType<typeof getHomeTasks>> = [];
  let dealOptions: { id: string; name: string }[] = [];
  let announcementRows: { announcement: typeof announcements.$inferSelect; author: typeof users.$inferSelect }[] = [];
  let isTeamOwner = false;

  if (teamId && session?.user?.id) {
    const [user, team] = await Promise.all([
      db.select().from(users).where(eq(users.id, session.user.id)).then((r) => r[0]),
      db.select().from(teams).where(eq(teams.id, teamId)).then((r) => r[0]),
    ]);
    welcomeSeen = user?.welcomeSeen ?? true;
    isTeamOwner = team?.ownerUserId === session.user.id;

    [homeUpdates, homeTasks, dealOptions, announcementRows] = await Promise.all([
      getHomeUpdates({ teamId }),
      getHomeTasks({ teamId }),
      db.select({ id: deals.id, name: deals.name }).from(deals).where(eq(deals.teamId, teamId)),
      db
        .select({ announcement: announcements, author: users })
        .from(announcements)
        .innerJoin(users, eq(announcements.authorUserId, users.id))
        .where(eq(announcements.teamId, teamId))
        .orderBy(desc(announcements.createdAt))
        .limit(20),
    ]);
  }

  return (
    <div className="flex flex-col gap-8">
      {teamId && session?.user?.id && (
        <WelcomeGate show={!welcomeSeen} name={session.user.name ?? null} />
      )}
      {teamId && session?.user?.id && (
        <AttentionPanel teamId={teamId} userId={session.user.id} />
      )}
      {teamId && (
        <AnnouncementsPanel
          isTeamOwner={isTeamOwner}
          initialAnnouncements={announcementRows.map((r) => ({
            id: r.announcement.id,
            content: r.announcement.content,
            createdAt: r.announcement.createdAt.toISOString(),
            author: { id: r.author.id, name: r.author.name, email: r.author.email, image: r.author.image },
          }))}
        />
      )}
      {teamId && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <HomeTasks initialTasks={homeTasks} deals={dealOptions} />
          <HomeUpdates updates={homeUpdates} />
        </div>
      )}
      <DashboardClient initialMeetings={serializable} />
    </div>
  );
}
