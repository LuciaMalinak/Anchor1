import { Logo } from "@/components/Logo";

// A small, deliberately CONTAINED "it's alive" touch for the wordmark —
// a soft glow directly behind the anchor glyph that gently breathes
// (see .pulse-glow in globals.css). Reads as "high-tech" on close look
// without asking for much attention, which matters here specifically:
// two earlier, page-wide background treatments on the dashboard were
// pulled after they read as noise rather than polish once actually
// visible. Scoped tightly to the glyph itself (not the whole header or
// page) is the whole point — small and contained, not another wash.
//
// Picks up whatever --accent is in scope (industry-tinted on the
// dashboard, the default brand copper on the marketing/auth pages),
// same variable the rest of the app already themes off of.
export function AnimatedLogo({
  size = "md",
}: {
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const dims = { sm: 22, md: 28, lg: 40, xl: 52 }[size];
  const glow = dims * 2.2;

  return (
    <span className="relative inline-flex items-center">
      <span
        aria-hidden="true"
        className="pulse-glow pointer-events-none absolute rounded-full"
        style={{
          width: glow,
          height: glow,
          left: -(glow - dims) / 2,
          top: "50%",
          marginTop: -glow / 2,
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--accent) 55%, transparent), transparent 72%)",
        }}
      />
      <Logo size={size} />
    </span>
  );
}
