import { notFound } from "next/navigation";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Logo } from "@/components/Logo";
import { JoinForm } from "./JoinForm";

// Public — no sign-in needed. This is the page behind the link shared
// from the Team page's "Invite people to request access" box. Submitting
// the form doesn't create an account or grant anything by itself; it
// just files a pending request that shows up on the Team page for
// someone already on the team to approve or decline.
export default async function JoinPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) notFound();

  return (
    <main className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-black/10 bg-brand">
        <div className="mx-auto flex max-w-xl items-center px-6 py-5">
          <Logo size="md" tone="light" />
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <p className="text-xs font-semibold tracking-[0.2em] text-accent">REQUEST TO JOIN</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-brand">{team.name}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Ask to join {team.name} on Anchor. Someone on the team reviews every request —
            you&apos;ll get an email once you&apos;re approved.
          </p>
          <JoinForm teamId={team.id} />
        </div>
      </div>
    </main>
  );
}
