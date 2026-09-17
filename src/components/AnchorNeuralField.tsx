// A big, faint line-art anchor sitting behind the hero, with a soft glow
// "current" running through its shaft and flukes, and thin neural traces
// radiating out to a scatter of small anchor nodes around it — the
// "high-tech anchor with neurons spreading to other anchors" background.
//
// Pure SVG + CSS animation (see the .neuro-* rules in globals.css),
// server-rendered and static-safe: everything here degrades to a plain
// still image under prefers-reduced-motion (same convention as the
// .reveal/.live-* motion elsewhere on this page).
const NODES: { x: number; y: number; scale: number; delay: number }[] = [
  { x: 150, y: 110, scale: 0.55, delay: 0 },
  { x: 1060, y: 95, scale: 0.42, delay: 0.6 },
  { x: 95, y: 430, scale: 0.48, delay: 1.2 },
  { x: 1130, y: 400, scale: 0.6, delay: 0.3 },
  { x: 260, y: 610, scale: 0.4, delay: 1.8 },
  { x: 940, y: 630, scale: 0.5, delay: 0.9 },
  { x: 630, y: 60, scale: 0.36, delay: 1.5 },
];

// One shared anchor glyph (identical path data to AnchorMark, 32x32
// viewBox) — reused for both the giant background anchor and every
// small node, just scaled differently, so they all read as the same
// mark.
function AnchorGlyph() {
  return (
    <>
      <circle cx="16" cy="7.5" r="2.25" />
      <path d="M16 9.75V24.5" />
      <path d="M11 13.5H21" />
      <path d="M8 18.5C8 22.5 11.5 25.5 16 25.5C20.5 25.5 24 22.5 24 18.5" />
      <path d="M8 18.5L6 15.8M8 18.5L10.3 17" />
      <path d="M24 18.5L26 15.8M24 18.5L21.7 17" />
    </>
  );
}

// Quadratic curve from a point near the big anchor's center out to a
// node, arced slightly so the traces read as organic neural pathways
// rather than straight wires.
function tracePath(cx: number, cy: number, x: number, y: number, bow: number) {
  const mx = (cx + x) / 2 + bow;
  const my = (cy + y) / 2 - bow * 0.6;
  return `M ${cx} ${cy} Q ${mx} ${my} ${x} ${y}`;
}

export function AnchorNeuralField() {
  const cx = 600;
  const cy = 350;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 700"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {/* Neural traces, drawn first so nodes/anchor sit on top */}
      <g className="neuro-trace-group" fill="none" stroke="#ffffff" strokeWidth="1" strokeLinecap="round">
        {NODES.map((n, i) => {
          const id = `neuro-trace-${i}`;
          const d = tracePath(cx, cy, n.x, n.y, i % 2 === 0 ? 60 : -60);
          return (
            <g key={id}>
              <path id={id} d={d} className="neuro-trace" />
              <circle r="4" className="neuro-pulse" fill="#c9793a" stroke="none">
                <animateMotion
                  dur={`${5 + (i % 3)}s`}
                  begin={`${n.delay}s`}
                  repeatCount="indefinite"
                  rotate="auto"
                >
                  <mpath href={`#${id}`} />
                </animateMotion>
              </circle>
            </g>
          );
        })}
      </g>

      {/* Small anchor nodes at each trace's far end */}
      {NODES.map((n, i) => (
        <g
          key={i}
          transform={`translate(${n.x} ${n.y}) scale(${n.scale}) translate(-16 -16)`}
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="neuro-node"
          style={{ animationDelay: `${n.delay}s` }}
        >
          <AnchorGlyph />
        </g>
      ))}

      {/* The big background anchor itself */}
      <g
        transform={`translate(${cx} ${cy}) scale(13.5) translate(-16 -16)`}
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.09"
        strokeWidth="0.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <AnchorGlyph />
      </g>

      {/* Glowing "current" traveling through the big anchor's shaft and
          base arc — the neurons "running through it" */}
      <g transform={`translate(${cx} ${cy}) scale(13.5) translate(-16 -16)`} fill="none" strokeLinecap="round">
        <path d="M16 9.75V24.5" className="neuro-glow neuro-glow-shaft" />
        <path
          d="M8 18.5C8 22.5 11.5 25.5 16 25.5C20.5 25.5 24 22.5 24 18.5"
          className="neuro-glow neuro-glow-arc"
        />
      </g>
    </svg>
  );
}
