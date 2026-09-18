import type { IndustryKey } from "@/lib/industries";

// A large, faint line-art scene tucked in the bottom-right corner of the
// dashboard — one per industry, so a real-estate team's Anchor visibly
// reads as "a clean modern building" and a pharma team's reads as "a
// molecule," instead of every sector looking like the same product with
// a different accent color. Deliberately background material: huge,
// low-opacity, plain currentColor line art (no photographic imagery) so
// it stays "high-tech simple clean" rather than competing with the
// actual dashboard content. Colored via `text-accent`, so it inherits
// whatever --accent the layout set for this team — nothing to keep in
// sync per industry beyond the shape itself.
//
// Deliberately layered ON TOP of the page (a small positive z-index),
// not behind it: most dashboard pages are nearly wall-to-wall white
// cards, so anything placed behind that content (negative z-index) has
// no gap left to actually show through and disappears completely no
// matter how high the opacity goes. pointer-events-none means it never
// intercepts a click or drag even where it overlaps a card, and it sits
// below the sticky header (z-10) so it never competes with real nav.
export function IndustryBackdrop({ industry }: { industry: IndustryKey | null }) {
  if (!industry) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed -bottom-10 -right-10 z-[1] text-accent opacity-[0.16]"
    >
      <svg width="480" height="480" viewBox="0 0 400 400" fill="none">
        {SCENES[industry]}
      </svg>
    </div>
  );
}

const strokeProps = {
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const SCENES: Record<IndustryKey, React.ReactNode> = {
  // A clean, high-rise building — a grid facade of windows and a rooftop
  // antenna, exactly the "high-tech simple clean building" mental image.
  real_estate: (
    <g {...strokeProps}>
      <rect x="120" y="60" width="160" height="300" rx="4" />
      <path d="M200 60V30" />
      <circle cx="200" cy="24" r="5" fill="currentColor" stroke="none" />
      {Array.from({ length: 7 }, (_, row) => (
        <g key={row}>
          {Array.from({ length: 4 }, (_, col) => (
            <rect
              key={col}
              x={138 + col * 30}
              y={90 + row * 34}
              width="18"
              height="20"
              rx="2"
            />
          ))}
        </g>
      ))}
      <rect x="170" y="320" width="60" height="40" rx="2" />
      <path d="M80 360H320" />
    </g>
  ),
  // An ascending bar chart with a trend line and arrowhead — "client
  // commitments and numbers," pointed up and to the right.
  finance: (
    <g {...strokeProps}>
      <path d="M70 340H330" />
      <rect x="100" y="260" width="34" height="80" rx="2" />
      <rect x="160" y="210" width="34" height="130" rx="2" />
      <rect x="220" y="150" width="34" height="190" rx="2" />
      <rect x="280" y="90" width="34" height="250" rx="2" />
      <path d="M100 250L160 195L220 135L297 80" strokeDasharray="2 8" />
      <path d="M270 80H300V110" />
    </g>
  ),
  // A rounded medical cross with a pulse line running through it.
  healthcare: (
    <g {...strokeProps}>
      <path d="M170 90H230V150H290V210H230V270H170V210H110V150H170Z" />
      <path d="M40 330H110L130 280L165 370L190 300L205 330H360" />
    </g>
  ),
  // A simple, welcoming bed silhouette — "remember every guest."
  hospitality: (
    <g {...strokeProps}>
      <path d="M60 260V180C60 166 71 155 85 155H140C154 155 165 166 165 180V210" />
      <path d="M165 210H320C331 210 340 219 340 230V300" />
      <path d="M60 210H340" />
      <path d="M60 260H340V300H60V260Z" />
      <path d="M70 300V340M330 300V340" />
    </g>
  ),
  // A small molecule diagram — classic chemistry/pharma shorthand.
  pharma: (
    <g {...strokeProps}>
      <path d="M180 170L280 120M180 170L290 230M180 170L120 260M180 170L110 130" />
      <circle cx="180" cy="170" r="28" />
      <circle cx="280" cy="120" r="20" />
      <circle cx="290" cy="230" r="22" />
      <circle cx="120" cy="260" r="18" />
      <circle cx="110" cy="130" r="16" />
    </g>
  ),
  // A chip with pins and an internal trace — plain "tech" shorthand,
  // in the same visual language as the marketing page's AI motif.
  tech: (
    <g {...strokeProps}>
      <rect x="140" y="140" width="140" height="140" rx="10" />
      {[170, 210, 250].map((x) => (
        <g key={x}>
          <path d={`M${x} 140V100`} />
          <path d={`M${x} 280V320`} />
        </g>
      ))}
      {[170, 210, 250].map((y) => (
        <g key={y}>
          <path d={`M140 ${y}H100`} />
          <path d={`M280 ${y}H320`} />
        </g>
      ))}
      <circle cx="180" cy="180" r="4" fill="currentColor" stroke="none" />
      <path d="M180 180H230V230" />
    </g>
  ),
};
