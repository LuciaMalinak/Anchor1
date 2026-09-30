"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A header tab that knows when it's the current section: darker text and
// an accent bar along the header's bottom edge. The parent nav stretches
// each tab to the header's full height so the bar lines up with the border.
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex shrink-0 items-center text-[15px] transition-colors ${
        active ? "font-medium text-brand" : "text-slate-500 hover:text-slate-900"
      }`}
    >
      {children}
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 -bottom-px h-[2.5px] rounded-full bg-accent transition-opacity ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
    </Link>
  );
}
