import Link from "next/link";
import Image from "next/image";
import { auth, signOut } from "@/auth";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { PageFade } from "@/components/PageFade";
import { NavLink } from "@/components/NavLink";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { getDailyBriefing, isBriefingStale } from "@/lib/dailyBriefing";
import { getIndustryTicker, isTickerStale, normalizeTickerItems, type TickerItem } from "@/lib/industryTicker";
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
  // The small scrolling ticker above it — same idea, much shorter items,
  // refreshed far more often (see src/lib/industryTicker.ts) so it
  // actually feels "live" rather than a once-a-shift roundup. Client-side
  // polling (see IndustryTicker.tsx) keeps it moving after this initial
  // load without anyone reloading the page.
  let tickerItems: TickerItem[] = [];
  let industryLabel: string | null = null;
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
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
      const teamIndustry = team?.industry && isIndustryKey(team.industry) ? team.industry : null;
      // Was awaited here — on a brand-new team (or any team whose
      // briefing hadn't refreshed yet that day) that meant every single
      // page in the dashboard, header and all, froze for several seconds
      // on a synchronous web-search call before rendering anything. Fired
      // in the background instead, same pattern already used for the
      // ticker just below: the page renders now with whatever's cached
      // (or nothing yet, on a brand-new team), and GeneralNewsSidebar's
      // client-side poll picks up the fresh result once this finishes.
      if (team && isBriefingStale(team.dailyBriefingUpdatedAt)) {
        const tid = teamId;
        getDailyBriefing(teamIndustry)
          .then((briefing) =>
            db
              .update(teams)
              .set({ dailyBriefing: briefing, dailyBriefingUpdatedAt: new Date() })
              .where(eq(teams.id, tid))
          )
          .catch((err) => console.error("Background daily briefing refresh failed:", err));
      }
      // Unlike the briefing above, this is never awaited here — a
      // 20-minute staleness window means near enough every page load
      // would otherwise pay for a synchronous web-search call, which is
      // exactly the kind of thing tonight's speed work was about
      // avoiding. The page renders with whatever's already cached (or
      // nothing, on a brand-new team, until the first poll lands one);
      // the client-side poller in IndustryTicker.tsx picks up the fresh
      // result a few minutes later once this finishes.
      if (team && isTickerStale(team.industryTickerUpdatedAt)) {
        const tid = teamId;
        getIndustryTicker(teamIndustry)
          .then((items) =>
            db
              .update(teams)
              .set({ industryTicker: items, industryTickerUpdatedAt: new Date() })
              .where(eq(teams.id, tid))
          )
          .catch((err) => console.error("Background industry ticker refresh failed:", err));
      }
      dailyBriefing = team?.dailyBriefing ?? null;
      dailyBriefingUpdatedAt = team?.dailyBriefingUpdatedAt ? team.dailyBriefingUpdatedAt.toISOString() : null;
      tickerItems = normalizeTickerItems(team?.industryTicker);
      if (teamIndustry) {
        industryLabel = INDUSTRY_BY_KEY[teamIndustry].label;
        const ind = INDUSTRY_BY_KEY[teamIndustry];
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
        <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 py-4 lg:flex-nowrap lg:px-10 2xl:px-16">
          <Link href="/dashboard">
            <AnimatedLogo size="lg" />
          </Link>
          {/* flex-wrap on the row above keeps this from being clipped on a
              phone-width screen (it used to just run off the right edge,
              unreachable, since the row itself never wrapped); overflow-x
              here is a second safety net in case even its own row is still
              too narrow for every item on a very small phone.

              The nav itself sits in a soft rounded "track" (bg-slate-100/70)
              so each NavLink's active state reads as a filled pill inside
              a segmented control, instead of floating text with an
              underline — a small change that makes the whole header feel
              more like a deliberate piece of UI and less like a plain
              list of links. */}
          <nav className="order-3 flex w-full items-center gap-1 overflow-x-auto rounded-full bg-slate-100/70 p-1 text-sm font-medium lg:order-none lg:w-auto lg:overflow-visible">
            <NavLink href="/dashboard/deals">Deals</NavLink>
            <NavLink href="/dashboard/insights">Insights</NavLink>
            <NavLink href="/dashboard/contacts">Contacts</NavLink>
            <NavLink href="/dashboard/team">Team</NavLink>
            <NavLink href="/dashboard/integrations">Integrations</NavLink>
          </nav>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <Link
              href="/dashboard/profile"
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-slate-100 hover:text-brand"
            >
              {session?.user?.image ? (
                <Image
                  src={session.user.image}
                  alt=""
                  width={28}
                  height={28}
                  unoptimized
                  className="h-7 w-7 rounded-full object-cover ring-2 ring-white"
                />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white ring-2 ring-white">
                  {(session?.user?.name || session?.user?.email || "?")[0]?.toUpperCase()}
                </span>
              )}
              <span className="font-medium text-slate-700">{session?.user?.name || session?.user?.email}</span>
            </Link>
            <span className="h-5 w-px bg-slate-200" aria-hidden="true" />
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="rounded-full px-3 py-1.5 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex w-full flex-1 flex-col gap-6 px-6 py-8 lg:flex-row lg:items-start lg:px-10 2xl:px-16">
        <div className="min-w-0 flex-1">
          <PageFade>{children}</PageFade>
        </div>
        <GeneralNewsSidebar
          // Keyed by industry so switching sectors (Team page -> Change)
          // fully remounts this instead of quietly keeping the OLD
          // sector's briefing/ticker text sitting in this component's own
          // React state. Without this key, changing team.industry clears
          // the cache server-side (see PATCH /api/team) and this component
          // gets fresh, empty `initial*` props on the next render — but a
          // client component's useState only reads its initial prop once,
          // on mount, so it would keep showing the previous sector's
          // already-loaded news indefinitely instead of picking up the
          // new one. Remounting resets that local state and restarts the
          // polling effects below from scratch, matching a subscriber's
          // actual expectation: they signed up for one specific sector,
          // and switching it should swap the news, not blend or freeze it.
          key={industryLabel ?? "general"}
          initialDailyBriefing={dailyBriefing}
          initialBriefingUpdatedAt={dailyBriefingUpdatedAt}
          initialTickerItems={tickerItems}
          industryLabel={industryLabel}
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
