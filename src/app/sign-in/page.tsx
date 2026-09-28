import Link from "next/link";
import { signIn } from "@/auth";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { INDUSTRY_BY_KEY, isIndustryKey } from "@/lib/industries";
import { SignInMethods } from "./SignInMethods";

const linkedInConfigured = Boolean(
  process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET
);
const googleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

const SIGN_IN_ERROR_COPY: Record<string, string> = {
  invalid: "Incorrect email or password.",
  missing: "Enter your email and password.",
  // These are Auth.js's own error "type" strings — now routed to this
  // page instead of its bare default error page (see `pages.error` in
  // src/auth.ts). "Configuration" is the generic bucket Auth.js uses for
  // basically any unexpected failure, including the magic-link email
  // failing to send, so its copy here is deliberately about that rather
  // than sounding like a broken server.
  Configuration:
    "We couldn't send that sign-in email just now — try again in a moment, or use Google, LinkedIn, or your password instead.",
  Verification: "That sign-in link has expired or was already used — request a new one below.",
  AccessDenied: "That sign-in attempt wasn't allowed. Try again, or use a different sign-in method.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; industry?: string }>;
}) {
  const { error, industry } = await searchParams;
  // Someone who clicked an industry link on the homepage — carry it
  // through sign-in so a brand-new account lands with that industry
  // already set (see /dashboard/page.tsx, which applies it once, only
  // for a fresh team that has no industry of its own yet).
  const industryKey = industry && isIndustryKey(industry) ? industry : null;
  const dashboardRedirect = industryKey ? `/dashboard?setIndustry=${industryKey}` : "/dashboard";

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-12">
      {/* Same soft, wide, blurred accent wash the dashboard header uses —
          nothing else, no dot grid or hard edge — so the auth pages read
          as the same product instead of a bare, unstyled form dropped on
          white. Two washes (top-right, bottom-left) instead of one,
          purely because this page has room to breathe that a header
          strip doesn't. */}
      <div
        aria-hidden="true"
        className="drift-bg pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 60% 45% at 85% -10%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 70%), radial-gradient(ellipse 55% 40% at -10% 110%, color-mix(in srgb, var(--brand) 8%, transparent), transparent 70%)",
        }}
      />

      <div className="flex w-full max-w-sm flex-col items-center gap-7">
        <div className="flex flex-col items-center gap-6 text-center">
          <AnimatedLogo size="xl" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Sign in
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Use Google or LinkedIn for one click, sign in with your password, or
              we&apos;ll email you a link instead — whichever&apos;s easiest.
            </p>
            {industryKey && (
              <p className="mt-2 text-xs font-medium text-accent">
                Setting up Anchor for {INDUSTRY_BY_KEY[industryKey].label}
              </p>
            )}
          </div>
        </div>

        <div className="flex w-full flex-col gap-6 rounded-2xl border border-slate-200/70 bg-white/90 p-7 shadow-xl shadow-slate-200/50 backdrop-blur-sm">

          <SignInMethods
            googleConfigured={googleConfigured}
            linkedInConfigured={linkedInConfigured}
            error={error}
            errorCopy={error ? SIGN_IN_ERROR_COPY[error] ?? "Something went wrong — try again." : null}
            onGoogle={async () => {
              "use server";
              await signIn("google", { redirectTo: dashboardRedirect });
            }}
            onLinkedIn={async () => {
              "use server";
              await signIn("linkedin", { redirectTo: dashboardRedirect });
            }}
            onMagicLink={async (formData) => {
              "use server";
              const email = formData.get("email") as string;
              await signIn("resend", { email, redirectTo: dashboardRedirect });
            }}
          >
            {/* Password sign-in never creates a new account (that only
                happens on /sign-up, which already requires this same
                acknowledgment) — so it's deliberately left outside
                SignInMethods's checkbox gate. See the comment there. */}
            <form action="/api/auth/password-sign-in" method="POST" className="flex flex-col gap-3">
              <input
                type="email"
                name="email"
                required
                placeholder="you@company.com"
                className="rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
              />
              <input
                type="password"
                name="password"
                required
                placeholder="Password"
                className="rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
              />
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" name="rememberMe" value="1" className="h-3.5 w-3.5 rounded border-slate-300" />
                Stay signed in
              </label>
              <button
                type="submit"
                className="rounded-xl bg-brand px-3 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-dark hover:shadow-md"
              >
                Sign in
              </button>
            </form>
          </SignInMethods>
        </div>

        <p className="text-center text-sm text-slate-500">
          New to Anchor?{" "}
          <Link
            href={industryKey ? `/sign-up?industry=${industryKey}` : "/sign-up"}
            className="font-medium text-brand hover:underline"
          >
            Create an account
          </Link>
        </p>

        <p className="text-center text-[11px] text-slate-400">
          <Link href="/terms" className="hover:text-slate-600 hover:underline">
            Terms
          </Link>{" "}
          ·{" "}
          <Link href="/privacy" className="hover:text-slate-600 hover:underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </main>
  );
}
