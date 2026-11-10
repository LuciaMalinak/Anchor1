"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAskAnchor } from "@/components/AskAnchorDock";

// The phone app's navigation: a tab bar along the bottom (Home, Deals,
// Record, Ask, More), like a native app, instead of the desktop links
// squeezed into the header. Only shown on narrow screens (md:hidden); the
// desktop header nav is unchanged. Sits above the iPhone home indicator
// (safe-area inset).

type Item = { href: string; label: string };

function Icon({ name, className = "h-6 w-6" }: { name: string; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {name === "home" && <path {...p} d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />}
      {name === "deals" && (
        <>
          <rect {...p} x="3" y="7" width="18" height="13" rx="2" />
          <path {...p} d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" />
        </>
      )}
      {name === "ask" && <path {...p} d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />}
      {name === "more" && (
        <>
          <circle cx="5" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function MobileTabBar({
  isOwner,
  ownsTeam,
  signOut,
}: {
  isOwner: boolean;
  ownsTeam: boolean;
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname() ?? "";
  const { open } = useAskAnchor();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string, exact = false) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const more: Item[] = [
    { href: "/dashboard/insights", label: "Insights" },
    { href: "/dashboard/contacts", label: "Contacts" },
    { href: "/dashboard/team", label: "Team" },
    { href: "/dashboard/integrations", label: "Integrations" },
    { href: "/dashboard/profile", label: "Profile & settings" },
    ...(ownsTeam ? [{ href: "/billing", label: "Billing" }] : []),
    ...(isOwner ? [{ href: "/dashboard/admin", label: "Admin" }] : []),
  ];
  const moreActive = more.some((m) => isActive(m.href));

  const tab = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium";
  const tone = (on: boolean) => (on ? "text-brand" : "text-slate-500");

  return (
    <>
      {/* Space so the last bit of every page isn't hidden behind the bar. */}
      <div className="h-20 md:hidden" aria-hidden="true" />
      <nav
        aria-label="App"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-md items-end px-2">
          <Link href="/dashboard" className={`${tab} ${tone(isActive("/dashboard", true))}`}>
            <Icon name="home" />
            Home
          </Link>
          <Link href="/dashboard/deals" className={`${tab} ${tone(isActive("/dashboard/deals"))}`}>
            <Icon name="deals" />
            Deals
          </Link>
          <Link href="/dashboard/record" className={`${tab} -mt-5`} aria-label="Record a meeting">
            <span
              className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-4 ring-white ${
                isActive("/dashboard/record") ? "bg-red-700" : "bg-red-600"
              }`}
            >
              <span className="h-5 w-5 rounded-full bg-white" />
            </span>
            <span className="text-slate-600">Record</span>
          </Link>
          <button type="button" onClick={open} className={`${tab} ${tone(false)}`}>
            <Icon name="ask" />
            Ask
          </button>
          <button type="button" onClick={() => setMoreOpen(true)} className={`${tab} ${tone(moreActive)}`}>
            <Icon name="more" />
            More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="rounded-t-2xl bg-white px-4 pt-3 shadow-xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="More"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
            <ul className="flex flex-col">
              {more.map((m) => (
                <li key={m.href}>
                  <Link
                    href={m.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center justify-between rounded-xl px-3 py-3.5 text-base ${
                      isActive(m.href) ? "bg-slate-100 font-semibold text-brand" : "text-slate-800"
                    }`}
                  >
                    {m.label}
                    <span className="text-slate-300">›</span>
                  </Link>
                </li>
              ))}
            </ul>
            <form action={signOut} className="mt-2 border-t border-slate-100 pt-2">
              <button type="submit" className="w-full rounded-xl px-3 py-3.5 text-left text-base text-red-600">
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
