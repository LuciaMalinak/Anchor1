import { signIn } from "@/auth";
import { Logo } from "@/components/Logo";

const linkedInConfigured = Boolean(
  process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET
);

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-6 text-center">
        <Logo size="md" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Sign in
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Use LinkedIn for one click, or we&apos;ll email you a link instead.
          </p>
        </div>
      </div>

      {linkedInConfigured && (
        <>
          <form
            action={async () => {
              "use server";
              await signIn("linkedin", { redirectTo: "/dashboard" });
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
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <div className="h-px flex-1 bg-slate-200" />
            or
            <div className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}

      <form
        action={async (formData) => {
          "use server";
          const email = formData.get("email") as string;
          await signIn("resend", { email, redirectTo: "/dashboard" });
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
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
        >
          Send sign-in link
        </button>
      </form>
    </main>
  );
}
