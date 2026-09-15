import { signIn } from "@/auth";

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Sign in to Anchor
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          We&apos;ll email you a link. No password to remember.
        </p>
      </div>
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
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Send sign-in link
        </button>
      </form>
    </main>
  );
}
