import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Logo } from "@/components/Logo";

const ERROR_COPY: Record<string, string> = {
  short: "Use at least 8 characters.",
  mismatch: "Those passwords didn't match — try again.",
};

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  // Already set (e.g. they got here via a stale link after doing this
  // already) — nothing to do, straight into the dashboard.
  if (session.user.hasPassword) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-6 text-center">
        <Logo size="md" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Create a password
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {user?.name ? `Welcome, ${user.name} — you're in.` : "You're in."} Set a
            password now so next time you can sign in directly, without waiting on an
            email.
          </p>
        </div>
      </div>

      <form action="/api/auth/set-password" method="POST" className="flex flex-col gap-3">
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoFocus
          placeholder="New password (min. 8 characters)"
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
        {error && (
          <p className="text-xs text-red-600">{ERROR_COPY[error] ?? "Something went wrong — try again."}</p>
        )}
        <button
          type="submit"
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
        >
          Set password & continue
        </button>
      </form>
    </main>
  );
}
