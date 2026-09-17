// Shared wordmark + anchor mark, matched to the investor deck: a thin
// line-art anchor glyph (no filled badge) in the deck's navy/copper, plus
// the "Anchor" wordmark. Same glyph as src/app/icon.svg (the favicon,
// which keeps a small filled backing for legibility at 16px) — keep the
// path data in sync if either changes.
//
// `tone="dark"` (default) is navy-on-light, for headers and white
// backgrounds. `tone="light"` is white-on-navy, for the hero section.
export function AnchorMark({
  size = 28,
  tone = "dark",
  className = "",
}: {
  size?: number;
  tone?: "dark" | "light";
  className?: string;
}) {
  const color = tone === "light" ? "#FFFFFF" : "#12294A";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <circle cx="16" cy="7.5" r="2.25" />
      <path d="M16 9.75V24.5" />
      <path d="M11 13.5H21" />
      <path d="M8 18.5C8 22.5 11.5 25.5 16 25.5C20.5 25.5 24 22.5 24 18.5" />
      <path d="M8 18.5L6 15.8M8 18.5L10.3 17" />
      <path d="M24 18.5L26 15.8M24 18.5L21.7 17" />
    </svg>
  );
}

export function Logo({
  size = "md",
  tone = "dark",
}: {
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "dark" | "light";
}) {
  const dims = { sm: 22, md: 28, lg: 40, xl: 52 }[size];
  const text = { sm: "text-base", md: "text-lg", lg: "text-2xl", xl: "text-3xl" }[size];

  return (
    <span className="inline-flex items-center gap-2">
      <AnchorMark size={dims} tone={tone} />
      <span
        className={`${text} font-semibold tracking-tight ${
          tone === "light" ? "text-white" : "text-slate-900"
        }`}
      >
        Anchor
      </span>
    </span>
  );
}
