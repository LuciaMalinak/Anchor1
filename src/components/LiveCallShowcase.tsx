"use client";

import { useEffect, useState } from "react";

// The homepage's "live call" showcase: a client call playing out on the
// left, and what Anchor.AI quietly tells you at that moment on the right.
// Plays on a slow loop; shown complete and still for anyone who prefers
// reduced motion. Purely illustrative content.

type Line = { who: "client" | "you"; name: string; text: string };
type Whisper = { kind: string; text: string; source: string };

const LINES: Line[] = [
  { who: "client", name: "Owner's representative", text: "Before we go further — what ADR did you assume for the first full year?" },
  { who: "you", name: "You", text: "We modelled it on what you shared in October." },
  { who: "client", name: "Owner's representative", text: "And the management fee — could you live with four percent base?" },
  { who: "you", name: "You", text: "Let's look at that against the incentive fee together." },
  { who: "client", name: "Owner's representative", text: "Fine. When can your team see the property?" },
];

// Shown after line i (index in LINES).
const WHISPERS: { after: number; w: Whisper }[] = [
  { after: 0, w: { kind: "The answer", text: "$2,400 ADR, 62% occupancy in year one.", source: "Call with the owners, Oct 22" } },
  { after: 2, w: { kind: "Hold the line", text: "Don't concede on 4% base: the board approved 3% with a 10% incentive fee.", source: "Board pack, Nov 3" } },
  { after: 4, w: { kind: "Next step", text: "Propose the site visit for Jan 10. Calendars are free; Anchor.AI will send the invites.", source: "Your calendar" } },
];

const STEP_MS = 2600;
const TOTAL = LINES.length + 3; // pause at the end before starting over

export function LiveCallShowcase() {
  const [step, setStep] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) {
      const id = requestAnimationFrame(() => setStill(true));
      return () => cancelAnimationFrame(id);
    }
    const timer = setInterval(() => setStep((s) => (s + 1) % TOTAL), STEP_MS);
    return () => clearInterval(timer);
  }, []);

  const shownLines = still ? LINES.length : Math.min(step + 1, LINES.length);
  const shownWhispers = WHISPERS.filter((x) => x.after < shownLines);

  return (
    <section className="relative z-10 -mt-24 px-6 sm:-mt-28" aria-label="Anchor.AI during a live call">
      <div className="mx-auto max-w-5xl">
        <div
          className="relative overflow-hidden rounded-[28px] border border-[#c9a27a]/25 p-[1px] shadow-[0_40px_120px_-30px_rgba(11,25,48,0.65)]"
          style={{ background: "linear-gradient(135deg, rgba(201,162,122,0.45), rgba(255,255,255,0.06) 35%, rgba(201,162,122,0.25))" }}
        >
          <div className="relative rounded-[27px] bg-[#0b1930]/95 px-6 py-8 backdrop-blur-xl sm:px-10 sm:py-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[27px]"
              style={{ background: "radial-gradient(ellipse 60% 50% at 85% 0%, rgba(180,83,31,0.18), transparent 70%)" }}
            />
            <div className="relative flex flex-col gap-2 text-center">
              <span className="text-[10px] font-semibold tracking-[0.32em] text-[#c9a27a]">IN THE ROOM WITH YOU</span>
              <h2 className="font-serif text-3xl italic text-white sm:text-4xl" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                Every word, remembered.
              </h2>
              <p className="mx-auto max-w-xl text-sm leading-relaxed text-slate-400">
                While the client speaks, Anchor.AI brings you the number from last month&apos;s call, the term
                you mustn&apos;t give away, and the next step — quietly, only on your screen.
              </p>
            </div>

            <div className="relative mt-8 grid gap-6 md:grid-cols-[1.25fr_1fr]">
              {/* The call */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-medium text-slate-300">
                    <span className="live-dot h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
                    Live · Resort operator selection
                  </span>
                  <span className="text-[11px] tabular-nums text-slate-500">00:{String(12 + shownLines * 3).padStart(2, "0")}:41</span>
                </div>
                <ol className="flex flex-col gap-3">
                  {LINES.map((l, i) => (
                    <li
                      key={i}
                      className={`transition-all duration-700 ease-out ${i < shownLines ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
                      aria-hidden={i >= shownLines}
                    >
                      <p className={`text-[11px] font-semibold tracking-wide ${l.who === "client" ? "text-[#c9a27a]" : "text-slate-400"}`}>{l.name}</p>
                      <p className={`text-sm leading-relaxed ${l.who === "client" ? "text-slate-100" : "text-slate-400"}`}>{l.text}</p>
                    </li>
                  ))}
                </ol>
              </div>

              {/* What Anchor.AI tells you */}
              <div className="flex flex-col gap-3">
                <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-slate-400">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-[#c9a27a]" fill="currentColor" aria-hidden="true">
                    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
                  </svg>
                  ONLY YOU SEE THIS
                </p>
                {WHISPERS.map(({ w }, i) => {
                  const on = shownWhispers.some((x) => x.w === w);
                  return (
                    <div
                      key={i}
                      className={`rounded-2xl border p-4 transition-all duration-700 ease-out ${
                        on ? "translate-x-0 border-[#c9a27a]/30 bg-[#c9a27a]/[0.07] opacity-100" : "translate-x-3 border-white/5 bg-transparent opacity-0"
                      }`}
                      aria-hidden={!on}
                    >
                      <p className="text-[10px] font-semibold tracking-[0.22em] text-[#c9a27a]">{w.kind.toUpperCase()}</p>
                      <p className="mt-1 text-sm leading-relaxed text-white">{w.text}</p>
                      <p className="mt-2 text-[11px] text-slate-500">From: {w.source}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-[11px] text-slate-400">Illustration. Your own calls, files and calendar power the real thing.</p>
      </div>
    </section>
  );
}
