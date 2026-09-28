"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A nav link that knows when it's the current section and shows it as a
// filled pill (white, with a soft shadow) sitting inside the header's
// track-colored nav group — the same "segmented control" pattern most
// modern SaaS dashboards use, rather than the plainer underline this
// used to be. Still eases in/out on hover via the global `a { transition
// }` rule in globals.css, so moving between sections still feels
// responsive, not just a hard on/off.
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`shrink-0 rounded-full px-3.5 py-1.5 transition-colors ${
        active
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-600 hover:bg-white/60 hover:text-brand"
      }`}
    >
      {children}
    </Link>
  );
}
