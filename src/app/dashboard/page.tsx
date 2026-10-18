import { Fragment, type ReactNode } from "react";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, users, deals, teams, announcements, morningBriefs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getOrCreateTeamId } from "@/lib/team";
import { getHomeUpdates } from "@/lib/homeFeed";
import { getHomeTasks } from "@/lib/homeTasks";
import { isIndustryKey } from "@/lib/industries";
import { resolveDashboardOrder, type DashboardSectionKey } from "@/lib/dashboardSections";
import { isColorThemeKey } from "@/lib/colorThemes";
import { AttentionPanel } from "./AttentionPanel";
import { AnnouncementsPanel } from "./AnnouncementsPanel";
import { DashboardClient } from "./DashboardClient";
import { DashboardCustomize } from "./DashboardCustomize";
import { HomeTasks } from "./HomeTasks";
import { HomeUpdates } from "./HomeUpdates";
import { MorningBriefPrompt } from "./MorningBriefPrompt";
import { DraftNowPanel } from "@/components/DraftNowPanel";
import { getGoogleConnection } from "@/lib/integrations/google";
import { GOOGLE_EXTRA_SCOPES } from "@/lib/integrations/config";
import { briefSettingsSaved, normalizePrefs } from "@/lib/morningBriefPrefs";
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
  let sectionOrder: DashboardSectionKey[] = resolveDashboardOrder(null);
  let colorTheme: string | null = null;
  let briefOn = true;
  let briefNeverSetUp = false;
  // Brief on with replies-to-drafts, but Gmail hasn't let Anchor create
  // drafts — so none can appear there until this is allowed.
  let needsDraftsPermission = false;
  let googleConnected = false;

  if (teamId && session?.user?.id) {
    const [user, team, brief, google] = await Promise.all([
      db.select().from(users).where(eq(users.id, session.user.id)).then((r) => r[0]),
      db.select().from(teams).where(eq(teams.id, teamId)).then((r) => r[0]),
      db
        .select({ enabled: morningBriefs.enabled, prefs: morningBriefs.prefs })
        .from(morningBriefs)
        .where(eq(morningBriefs.userId, session.user.id))
        .then((r) => r[0])
        .catch(() => undefined),
      getGoogleConnection(session.user.id).catch(() => null),
    ]);
    googleConnected = Boolean(google);
    needsDraftsPermission = Boolean(
      normalizePrefs(brief?.prefs).draftReplies &&
        google &&
        !(google.scope ?? "").split(/\s+/).includes(GOOGLE_EXTRA_SCOPES.gmail_compose)
    );
    briefOn = brief?.enabled ?? false;
    briefNeverSetUp = !brief || (!brief.enabled && !briefSettingsSaved(brief.prefs));
    welcomeSeen = user?.welcomeSeen ?? true;
    isTeamOwner = team?.ownerUserId === session.user.id;
    sectionOrder = resolveDashboardOrder(user?.dashboardLayout);
    colorTheme = user?.colorTheme && isColorThemeKey(user.colorTheme) ? user.colorTheme : null;

    // Promise.allSettled rather than Promise.all — a single rejection
    // (one bad row, a flaky query, a bug in one section's own data
    // fetch) used to reject the whole Promise.all with nothing catching
    // it here, which crashed this entire Home page into the site-wide
    // error boundary — even the always-available meeting upload/join
    // panel above (already rendered from data fetched earlier, unrelated
    // to this Promise.all) never got a chance to show. Each section now
    // degrades to an empty default on its own failure instead of taking
    // the rest of the page down with it — same idea layout.tsx already
    // uses for its own team-data fetch.
    const [updatesResult, tasksResult, dealsResult, announcementsResult] = await Promise.allSettled([
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
    homeUpdates = updatesResult.status === "fulfilled" ? updatesResult.value : [];
    homeTasks = tasksResult.status === "fulfilled" ? tasksResult.value : [];
    dealOptions = dealsResult.status === "fulfilled" ? dealsResult.value : [];
    announcementRows = announcementsResult.status === "fulfilled" ? announcementsResult.value : [];
    for (const result of [updatesResult, tasksResult, dealsResult, announcementsResult]) {
      if (result.status === "rejected") {
        console.error("[dashboard] a home-page section failed to load:", result.reason);
      }
    }
  }

  // Rendered in this person's own saved order (sectionOrder) rather than a
  // fixed sequence — see DashboardCustomize.tsx and users.dashboardLayout
  // in schema.ts. "meetings" is one of the reorderable sections too (see
  // DASHBOARD_SECTIONS in dashboardSections.ts) and always has something to
  // show, even for a brand-new, team-less account — the other sections only
  // appear once there's a team.
  const sectionByKey: Partial<Record<DashboardSectionKey, ReactNode>> = {
    meetings: <DashboardClient initialMeetings={serializable} />,
    ...(teamId && session?.user?.id
      ? {
          attention: <AttentionPanel teamId={teamId} userId={session.user.id} />,
          announcements: (
            <AnnouncementsPanel
              isTeamOwner={isTeamOwner}
              initialAnnouncements={announcementRows.map((r) => ({
                id: r.announcement.id,
                content: r.announcement.content,
                createdAt: r.announcement.createdAt.toISOString(),
                author: { id: r.author.id, name: r.author.name, email: r.author.email, image: r.author.image },
              }))}
            />
          ),
          tasksAndUpdates: (
            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <HomeTasks initialTasks={homeTasks} deals={dealOptions} />
              <HomeUpdates updates={homeUpdates} />
            </div>
          ),
        }
      : {}),
  };

  return (
    <div className="flex flex-col gap-8">
      {teamId && session?.user?.id && (
        <WelcomeGate show={!welcomeSeen} name={session.user.name ?? null} />
      )}
      {teamId && (
        <DashboardCustomize
          initialOrder={sectionOrder}
          initialColorTheme={colorTheme && isColorThemeKey(colorTheme) ? colorTheme : null}
        />
      )}
      {teamId && !briefOn && <MorningBriefPrompt neverSetUp={briefNeverSetUp} />}
      {needsDraftsPermission && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-amber-900">Let Anchor write replies straight into your Gmail drafts</h2>
            <p className="mt-1 max-w-2xl text-sm text-amber-800">
              As emails come in, Anchor drafts a reply the way you write and leaves it in Gmail, ready to send. Google needs you to allow
              this once. Nothing is ever sent without you.
            </p>
          </div>
          <a
            href="/api/integrations/google/connect?add=gmail_compose&returnTo=%2Fdashboard"
            className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            Allow Gmail drafts
          </a>
        </section>
      )}
      {googleConnected && <DraftNowPanel />}
      {sectionOrder.map((key) => (
        <Fragment key={key}>{sectionByKey[key] ?? null}</Fragment>
      ))}
    </div>
  );
}
