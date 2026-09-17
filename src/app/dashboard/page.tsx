import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, users, deals } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { getHomeUpdates } from "@/lib/homeFeed";
import { getHomeTasks } from "@/lib/homeTasks";
import { AttentionPanel } from "./AttentionPanel";
import { DashboardClient } from "./DashboardClient";
import { HomeTasks } from "./HomeTasks";
import { HomeUpdates } from "./HomeUpdates";
import { WelcomeGate } from "./WelcomeGate";

export default async function DashboardPage() {
  const session = await auth();
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

  let welcomeSeen = true;
  let homeUpdates: Awaited<ReturnType<typeof getHomeUpdates>> = [];
  let homeTasks: Awaited<ReturnType<typeof getHomeTasks>> = [];
  let dealOptions: { id: string; name: string }[] = [];

  if (teamId && session?.user?.id) {
    const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
    welcomeSeen = user?.welcomeSeen ?? true;

    [homeUpdates, homeTasks, dealOptions] = await Promise.all([
      getHomeUpdates({ teamId }),
      getHomeTasks({ teamId }),
      db.select({ id: deals.id, name: deals.name }).from(deals).where(eq(deals.teamId, teamId)),
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
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <HomeTasks initialTasks={homeTasks} deals={dealOptions} />
          <HomeUpdates updates={homeUpdates} />
        </div>
      )}
      <DashboardClient initialMeetings={serializable} />
    </div>
  );
}
