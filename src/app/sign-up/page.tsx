import Link from "next/link";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { INDUSTRY_BY_KEY, isIndustryKey } from "@/lib/industries";

const SIGN_UP_ERROR_COPY: Record<string, string> = {
  missing: "Enter an email and password.",
  short: "Use at least 8 characters for your password.",
  mismatch: "Those passwords didn't match — try again.",
  exists: "An account already exists for that email — sign in instead.",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; industry?: string }>;
}) {
  const { error, industry } = await searchParams;
  const industryKey = industry && isIndustryKey(industry) ? industry : null;
  const signInHref = industryKey ? `/sign-in?industry=${industryKey}` : "/sign-in";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-6 text-center">
        <AnimatedLogo size="md" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Create your account
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Just an email and a password — you&apos;re in right away, nothing to confirm.
          </p>
          {industryKey && (
            <p className="mt-2 text-xs font-medium text-accent">
              Setting up Anchor for {INDUSTRY_BY_KEY[industryKey].label}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-xs text-red-600">
          {SIGN_UP_ERROR_COPY[error] ?? "Something went wrong — try again."}
        </p>
      )}

      <form action="/api/auth/password-sign-up" method="POST" className="flex flex-col gap-3">
        {industryKey && <input type="hidden" name="industry" value={industryKey} />}
        <input
          type="text"
          name="name"
          placeholder="Your name (optional)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          type="email"
          name="email"
          required
          autoFocus
          placeholder="you@company.com"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          type="password"
          name="password"
          required
          minLength={8}
          placeholder="Password (min. 8 characters)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          type="password"
          name="confirmPassword"
          required
          minLength={8}
          placeholder="Confirm password"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
        >
          Create account
        </button>
      </form>

      <p className="text-center text-xs text-slate-400">
        Already have an account?{" "}
        <Link href={signInHref} className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>

      <p className="text-center text-[11px] text-slate-400">
        By creating an account, you agree to Anchor&apos;s{" "}
        <Link href="/terms" className="hover:text-slate-600 hover:underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="hover:text-slate-600 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  );
}
