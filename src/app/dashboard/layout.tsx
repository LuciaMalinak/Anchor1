import Link from "next/link";
import Image from "next/image";
import { auth, signOut } from "@/auth";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { getDailyBriefing, isBriefingStale } from "@/lib/dailyBriefing";
import { GeneralNewsSidebar } from "./GeneralNewsSidebar";
import { INDUSTRY_BY_KEY, isIndustryKey } from "@/lib/industries";

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
  // Small, purely cosmetic reskin: if the team picked an industry on the
  // Team page (see src/lib/industries.ts), swap the --accent/--accent-dark
  // CSS variables for the rest of the dashboard to that industry's color —
  // every `accent`-based Tailwind class (bg-accent, text-accent, etc.)
  // picks it up automatically since they resolve through those variables
  // (see globals.css's `@theme inline` block). Null/unrecognized just
  // falls through to the default brand accent, same as always.
  let accentStyle: React.CSSProperties | undefined;
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
      if (team?.industry && isIndustryKey(team.industry)) {
        const ind = INDUSTRY_BY_KEY[team.industry];
        accentStyle = { "--accent": ind.accent, "--accent-dark": ind.accentDark } as React.CSSProperties;
      }
    } catch (err) {
      console.error("Couldn't load team daily briefing:", err);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50" style={accentStyle}>
      {/* A fixed backdrop tinted by the team's --accent (set above from
          src/lib/industries.ts) — one soft, wide, blurred wash in the top
          corner, nothing else. Reads the CSS variable rather than
          hardcoding a color per industry, so every sector's dashboard has
          a subtly different color temperature for free. Deliberately
          restrained this time: no dot grid, no hard edge, low enough
          opacity that it reads as "premium ambient light" rather than a
          pattern or a stripe — the loud version of this (visible dots,
          35% opacity) is exactly what got called out as unprofessional.
          Fixed + negative z-index + pointer-events-none, so it never
          intercepts clicks or competes with real content. */}
      <div
        aria-hidden="true"
        className="drift-bg pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 55% 38% at 82% -8%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 72%)",
        }}
      />
      {/* Plain white header, neutral border — no colored stripe. The bright
          solid accent bar this used to have (linear-gradient, 3px, full
          width) is exactly what read as a garish "bar/glow" rather than
          professional branding; the accent now shows up only in small,
          deliberate touches (the signed-in avatar, hover states, buttons)
          instead of a loud band across the top of every page. */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex w-full items-center justify-between px-6 py-4 lg:px-10 2xl:px-16">
          <Link href="/dashboard">
            <AnimatedLogo size="lg" />
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
      <main className="flex w-full flex-1 flex-col gap-6 px-6 py-8 lg:flex-row lg:items-start lg:px-10 2xl:px-16">
        <div className="min-w-0 flex-1">{children}</div>
        <GeneralNewsSidebar
          initialDailyBriefing={dailyBriefing}
          initialBriefingUpdatedAt={dailyBriefingUpdatedAt}
        />
      </main>
      {/* Small, quiet footer on every dashboard page — the site's Terms
          and Privacy links previously only lived on the marketing
          homepage, so someone who signed up straight from a sign-up link
          and never saw that page had no way to find them. */}
      <footer className="mt-auto border-t border-slate-100 px-6 py-6 text-center text-xs text-slate-400 lg:px-10 2xl:px-16">
        © {new Date().getFullYear()} Anchor ·{" "}
        <Link href="/terms" className="hover:text-slate-600 hover:underline">
          Terms
        </Link>{" "}
        ·{" "}
        <Link href="/privacy" className="hover:text-slate-600 hover:underline">
          Privacy
        </Link>
      </footer>
    </div>
  );
}
