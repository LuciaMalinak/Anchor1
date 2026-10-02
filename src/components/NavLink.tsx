"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A header nav link on the navy dashboard header: the current section is
// a soft white pill with a faint outline, the rest are muted until
// hovered. `exact` is for
// Home (/dashboard), which would otherwise match every page under it.
export function NavLink({
  href,
  exact = false,
  children,
}: {
  href: string;
  exact?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-full px-3.5 py-1.5 transition-colors ${
        active
          ? "bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
          : "text-slate-300 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}
