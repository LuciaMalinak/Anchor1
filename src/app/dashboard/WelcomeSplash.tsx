"use client";

import { useEffect, useState } from "react";
import { AnchorMark } from "@/components/Logo";

type Stage = "before" | "in" | "out";

// A one-time, full-screen "you're in" moment — shown right after someone
// (typically a just-invited teammate) signs in for the first time and
// lands on the dashboard, before the home page underneath is revealed.
// Purely a transition: no interaction, nothing to click, just a brief
// pause on the brand before the real content takes over. Marks itself
// seen (via the parent's onDone) so it never plays again for this person.
export function WelcomeSplash({ name, onDone }: { name: string | null; onDone: () => void }) {
  const [stage, setStage] = useState<Stage>("before");

  useEffect(() => {
    const toIn = setTimeout(() => setStage("in"), 30);
    const toOut = setTimeout(() => setStage("out"), 1700);
    const finish = setTimeout(onDone, 2300);
    return () => {
      clearTimeout(toIn);
      clearTimeout(toOut);
      clearTimeout(finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-brand transition-opacity duration-500 ease-out ${
        stage === "out" ? "opacity-0" : "opacity-100"
      }`}
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex flex-col items-center gap-4 transition-all duration-700 ease-out ${
          stage === "before" ? "scale-90 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        <AnchorMark size={64} tone="light" />
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl font-semibold tracking-tight text-white">Anchor</span>
          <span className="text-sm text-white/70">
            {name ? `Welcome, ${name}` : "Welcome"} — you&apos;re in.
          </span>
        </div>
      </div>
    </div>
  );
}
