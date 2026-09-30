"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A nav link that knows when it's the current section: plain text links,
// with the current one darker and underlined in navy, as in the product
// design. Still eases in/out on hover via the global `a { transition }`
// rule in globals.css.
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`shrink-0 px-1 py-1.5 transition-colors ${
        active
          ? "text-slate-900 underline decoration-brand decoration-[1.5px] underline-offset-[9px]"
          : "text-slate-500 hover:text-slate-900"
      }`}
    >
      {children}
    </Link>
  );
}
