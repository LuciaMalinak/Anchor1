// Anchor's logo: a bold anchor in navy (#12294A) with a copper ring
// (#B4531F), the same mark as the browser tab icon, the email header, the
// desktop app and the LinkedIn Page. Every icon file is drawn from the
// same shapes by scripts/generate-brand-assets.mjs, and the desktop app's
// window repeats them in desktop/src/renderer/index.html: keep all three
// in sync if the logo changes.
//
// `tone="dark"` (default) is a navy anchor, for headers and white
// backgrounds. `tone="light"` is a white anchor, for navy backgrounds.
// The ring is copper in both.
export function AnchorMark({
  size = 28,
  tone = "dark",
  className = "",
}: {
  size?: number;
  tone?: "dark" | "light";
  className?: string;
}) {
  const body = tone === "light" ? "#FFFFFF" : "#12294A";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="256" cy="92" r="38" stroke="#B4531F" strokeWidth="28" />
        <line x1="256" y1="160" x2="256" y2="430" stroke={body} strokeWidth="34" />
        <line x1="164" y1="196" x2="348" y2="196" stroke={body} strokeWidth="34" />
        <path d="M104 300 C 112 392 180 446 256 446 C 332 446 400 392 408 300" stroke={body} strokeWidth="34" />
      </g>
      <g fill={body}>
        <path d="M70 318 L104 252 L140 318 Z" />
        <path d="M372 318 L408 252 L442 318 Z" />
      </g>
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
