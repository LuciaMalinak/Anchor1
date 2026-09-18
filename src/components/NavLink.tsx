"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A nav link that knows when it's the current section and shows it with
// a colored underline that eases in/out (via the global `a { transition }`
// rule in globals.css) rather than just snapping between plain-text and
// bold. Small, functional motion — it's telling you where you are, not
// just decorating the header.
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`border-b-2 pb-1 ${
        active
          ? "border-accent text-slate-900"
          : "border-transparent text-slate-600 hover:border-slate-300 hover:text-brand"
      }`}
    >
      {children}
    </Link>
  );
}
