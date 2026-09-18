import Link from "next/link";
import { signIn } from "@/auth";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { INDUSTRY_BY_KEY, isIndustryKey } from "@/lib/industries";

const linkedInConfigured = Boolean(
  process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET
);
const googleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

const SIGN_IN_ERROR_COPY: Record<string, string> = {
  invalid: "Incorrect email or password.",
  missing: "Enter your email and password.",
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-6 text-center">
        <AnimatedLogo size="md" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Sign in
          </h1>
          <p className="mt-1 text-sm text-slate-500">
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

      {(googleConfigured || linkedInConfigured) && (
        <>
          <div className="flex flex-col gap-2">
            {googleConfigured && (
              <form
                action={async () => {
                  "use server";
                  await signIn("google", { redirectTo: dashboardRedirect });
                }}
              >
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-400"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.48a5.54 5.54 0 0 1-2.4 3.64v3h3.88c2.27-2.09 3.56-5.17 3.56-8.83z" />
                    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.96-2.9l-3.88-3c-1.08.72-2.45 1.15-4.08 1.15-3.14 0-5.8-2.12-6.75-4.96H1.24v3.1A12 12 0 0 0 12 24z" />
                    <path fill="#FBBC05" d="M5.25 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.24a12 12 0 0 0 0 10.78l4.01-3.1z" />
                    <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.24 6.61l4.01 3.1C6.2 6.87 8.86 4.75 12 4.75z" />
                  </svg>
                  Continue with Google
                </button>
              </form>
            )}
            {linkedInConfigured && (
              <form
                action={async () => {
                  "use server";
                  await signIn("linkedin", { redirectTo: dashboardRedirect });
                }}
              >
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0A66C2] px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#004182]"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.15 1.45-2.15 2.94v5.67H9.34V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.11 20.45H3.56V9h3.55v11.45z" />
                  </svg>
                  Continue with LinkedIn
                </button>
              </form>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <div className="h-px flex-1 bg-slate-200" />
            or
            <div className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-xs text-red-600">
          {SIGN_IN_ERROR_COPY[error] ?? "Something went wrong — try again."}
        </p>
      )}

      <form action="/api/auth/password-sign-in" method="POST" className="flex flex-col gap-3">
        <input
          type="email"
          name="email"
          required
          placeholder="you@company.com"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          type="password"
          name="password"
          required
          placeholder="Password"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" name="rememberMe" value="1" className="h-3.5 w-3.5 rounded border-slate-300" />
          Stay signed in
        </label>
        <button
          type="submit"
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
        >
          Sign in
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        no password yet, or forgot it?
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <form
        action={async (formData) => {
          "use server";
          const email = formData.get("email") as string;
          await signIn("resend", { email, redirectTo: dashboardRedirect });
        }}
        className="flex flex-col gap-3"
      >
        <input
          type="email"
          name="email"
          required
          placeholder="you@company.com"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
        >
          Email me a sign-in link
        </button>
      </form>

      <p className="text-center text-xs text-slate-400">
        New to Anchor?{" "}
        <Link
          href={industryKey ? `/sign-up?industry=${industryKey}` : "/sign-up"}
          className="font-medium text-brand hover:underline"
        >
          Create an account
        </Link>
      </p>
    </main>
  );
}
