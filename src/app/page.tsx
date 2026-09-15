import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
        Anchor
      </h1>
      <p className="text-slate-500">
        Upload a meeting recording. Get a transcript, a summary, and context
        that carries forward the next time you meet the same people.
      </p>
      <Link
        href="/sign-in"
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Sign in
      </Link>
    </main>
  );
}
