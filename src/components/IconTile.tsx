// Small coloured rounded-square icon shown before a card's title, as in the
// product design ("Follow-up email" with a red mail tile, "Suggested invite"
// with a blue calendar tile). White line icons, one colour per kind.
const KINDS = {
  mail: { bg: "#d4583a", path: "M4 7l8 5.5L20 7M5 6h14a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z" },
  calendar: { bg: "#3a78e7", path: "M7 3v3M17 3v3M4.5 9h15M6 5h12a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0118 19H6a1.5 1.5 0 01-1.5-1.5v-11A1.5 1.5 0 016 5z" },
  megaphone: { bg: "#12294a", path: "M4 10v4l3 .5L15 18V6L7 9.5 4 10zM15 9.5c1.5.3 2.5 1.3 2.5 2.5s-1 2.2-2.5 2.5M7 14.5l1 4" },
  check: { bg: "#b4531f", path: "M5 12.5l4 4 10-10" },
  pulse: { bg: "#4f7cac", path: "M3 12h4l2.5-6 5 12 2.5-6h4" },
  video: { bg: "#12294a", path: "M4 7.5A1.5 1.5 0 015.5 6h8A1.5 1.5 0 0115 7.5v9a1.5 1.5 0 01-1.5 1.5h-8A1.5 1.5 0 014 16.5v-9zM15 10.5l5-3v9l-5-3" },
  mic: { bg: "#b4531f", path: "M12 4a2.5 2.5 0 012.5 2.5v5a2.5 2.5 0 01-5 0v-5A2.5 2.5 0 0112 4zM6.5 11.5a5.5 5.5 0 0011 0M12 17v3" },
  upload: { bg: "#64748b", path: "M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14" },
  alert: { bg: "#c98a1b", path: "M12 8v5M12 16.5v.5M10.3 4.8L3.6 17a2 2 0 001.7 3h13.4a2 2 0 001.7-3L13.7 4.8a2 2 0 00-3.4 0z" },
  list: { bg: "#12294a", path: "M9 7h10M9 12h10M9 17h10M5 7h.01M5 12h.01M5 17h.01" },
} as const;

export type IconKind = keyof typeof KINDS;

export function IconTile({ kind, size = 26 }: { kind: IconKind; size?: number }) {
  const k = KINDS[kind];
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-md"
      style={{ width: size, height: size, background: k.bg }}
    >
      <svg
        width={size * 0.6}
        height={size * 0.6}
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={k.path} />
      </svg>
    </span>
  );
}
