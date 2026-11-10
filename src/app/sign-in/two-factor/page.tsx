import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { sessionCookieName } from "@/lib/auth/password";
import { needsSecondStep, sessionWithUser } from "@/lib/auth/twoFactor";
import { safeReturnTo } from "@/lib/integrations/returnTo";

const ERROR_COPY: Record<string, string> = {
  invalid: "That code didn't work. Use the newest code from your authenticator app, or a recovery code.",
  locked: "Too many tries. Wait 15 minutes and try again.",
};

// Second step of signing in for people with two-step verification on
// (src/lib/auth/twoFactor.ts). src/proxy.ts sends them here.
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = safeReturnTo(rawNext ?? null);
  const token = (await cookies()).get(sessionCookieName())?.value;
  const row = await sessionWithUser(token);
  if (!row) redirect("/sign-in");
  if (!needsSecondStep(row.user, row.session)) redirect(next ?? "/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-6 text-center">
        <Logo size="md" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Enter your code</h1>
          <p className="mt-1 text-sm text-slate-500">
            Open your authenticator app and enter the 6-digit code for Anchor.AI.
          </p>
        </div>
      </div>
      <form action="/api/auth/two-factor/verify" method="POST" className="flex flex-col gap-3">
        {next && <input type="hidden" name="next" value={next} />}
        <input
          name="code"
          required
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123 456"
          className="rounded-xl border border-slate-300 px-3.5 py-2.5 text-center text-lg tracking-[0.3em] outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
        />
        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-center text-xs text-red-600">
            {ERROR_COPY[error] ?? "Something went wrong — try again."}
          </p>
        )}
        <button type="submit" className="rounded-xl bg-brand px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark">
          Continue
        </button>
      </form>
      <p className="text-center text-xs leading-relaxed text-slate-500">
        Lost your phone? Type one of your recovery codes in the box above instead. If you
        don&apos;t have them, ask your team owner or email{" "}
        <a href="mailto:lucia@anchortechnolgies.com" className="text-brand hover:underline">lucia@anchortechnolgies.com</a>.
        <br />
        <Link href="/sign-in" className="mt-2 inline-block text-brand hover:underline">Use a different account</Link>
      </p>
    </main>
  );
}
