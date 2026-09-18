"use client";

import { usePathname } from "next/navigation";

// A quiet fade-up on every dashboard page's main content, so moving
// between Deals/Insights/Contacts/etc. feels a little more alive than
// content just snapping into place. Reuses .enter-fade — the same
// fadeUp animation already used for the marketing homepage's hero —
// keyed by the route so it replays on every navigation rather than
// just once on first load. Same restraint as everything else added
// this round: quick (0.8s), small (14px), and fully disabled under
// prefers-reduced-motion via the existing .enter-fade rule.
export function PageFade({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="enter-fade">
      {children}
    </div>
  );
}
