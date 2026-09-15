// Shared wordmark + anchor mark, used on the header, sign-in, and landing
// pages so the brand is consistent everywhere. Same glyph as
// src/app/icon.svg (the favicon) — keep them in sync if either changes.
export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dims = { sm: 22, md: 28, lg: 40 }[size];
  const text = { sm: "text-base", md: "text-lg", lg: "text-2xl" }[size];

  return (
    <span className="inline-flex items-center gap-2">
      <svg
        width={dims}
        height={dims}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="32" height="32" rx="8" fill="#0F172A" />
        <circle cx="16" cy="9" r="3" stroke="#F59E0B" strokeWidth="2" />
        <path d="M16 12V25" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M8 18C8 22 11.5 25 16 25C20.5 25 24 22 24 18"
          stroke="#F59E0B"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M10 15H22" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className={`${text} font-semibold tracking-tight text-slate-900`}>Anchor</span>
    </span>
  );
}
