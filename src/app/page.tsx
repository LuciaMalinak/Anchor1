import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-white to-slate-50 px-6">
      <div className="flex max-w-lg flex-col items-center gap-6 text-center">
        <Logo size="lg" />
        <p className="text-lg text-slate-600">
          Anchor turns your meetings into context that carries forward — a transcript,
          a summary, and a running memory of the people you talk to, so the next
          conversation starts where the last one left off.
        </p>
        <div className="flex flex-col gap-3 text-left text-sm text-slate-500 sm:flex-row sm:gap-8">
          <span>Upload a recording, or let Anchor join the call</span>
          <span>Automatic transcript &amp; summary</span>
          <span>Remembers people across meetings</span>
        </div>
        <Link
          href="/sign-in"
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
