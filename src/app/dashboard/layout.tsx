import Link from "next/link";
import Image from "next/image";
import { auth, signOut } from "@/auth";
import { Logo } from "@/components/Logo";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { getDailyBriefing, isBriefingStale } from "@/lib/dailyBriefing";
import { GeneralNewsSidebar } from "./GeneralNewsSidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Team-wide "what's worth knowing today" news — lives in this shared
  // layout (not the deal page) so it can run persistently across the main
  // site, Bloomberg-ticker style. Same throttled, best-effort pattern used
  // elsewhere: refreshed at most once a day per team, never blocks the page.
  let dailyBriefing: string | null = null;
  let dailyBriefingUpdatedAt: string | null = null;
  if (session?.user?.id) {
    try {
      const teamId = await getOrCreateTeamId(session.user.id);
      let [team] = await db.select().from(teams).where(eq(teams.id, teamId));
      if (team && isBriefingStale(team.dailyBriefingUpdatedAt)) {
        try {
          const briefing = await getDailyBriefing();
          const updatedAt = new Date();
          await db.update(teams).set({ dailyBriefing: briefing, dailyBriefingUpdatedAt: updatedAt }).where(eq(teams.id, teamId));
          team = { ...team, dailyBriefing: briefing, dailyBriefingUpdatedAt: updatedAt };
        } catch (err) {
          console.error("Background daily briefing refresh failed:", err);
        }
      }
      dailyBriefing = team?.dailyBriefing ?? null;
      dailyBriefingUpdatedAt = team?.dailyBriefingUpdatedAt ? team.dailyBriefingUpdatedAt.toISOString() : null;
    } catch (err) {
      console.error("Couldn't load team daily briefing:", err);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex w-full items-center justify-between px-6 py-4 lg:px-10 2xl:px-16">
          <Link href="/dashboard">
            <Logo size="lg" />
          </Link>
          <nav className="flex items-center gap-5 text-sm font-medium text-slate-600">
            <Link href="/dashboard/deals" className="hover:text-brand">
              Deals
            </Link>
            <Link href="/dashboard/insights" className="hover:text-brand">
              Insights
            </Link>
            <Link href="/dashboard/contacts" className="hover:text-brand">
              Contacts
            </Link>
            <Link href="/dashboard/team" className="hover:text-brand">
              Team
            </Link>
            <Link href="/dashboard/integrations" className="hover:text-brand">
              Integrations
            </Link>
          </nav>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <Link href="/dashboard/profile" className="flex items-center gap-2 hover:text-brand">
              {session?.user?.image ? (
                <Image
                  src={session.user.image}
                  alt=""
                  width={24}
                  height={24}
                  unoptimized
                  className="h-6 w-6 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-white">
                  {(session?.user?.name || session?.user?.email || "?")[0]?.toUpperCase()}
                </span>
              )}
              <span>{session?.user?.name || session?.user?.email}</span>
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button type="submit" className="hover:text-slate-900">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex w-full flex-col gap-6 px-6 py-8 lg:flex-row lg:items-start lg:px-10 2xl:px-16">
        <div className="min-w-0 flex-1">{children}</div>
        <GeneralNewsSidebar
          initialDailyBriefing={dailyBriefing}
          initialBriefingUpdatedAt={dailyBriefingUpdatedAt}
        />
      </main>
    </div>
  );
}
