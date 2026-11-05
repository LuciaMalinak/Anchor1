import Link from "next/link";
import { requireAppOwnerPage } from "@/lib/adminAccess";
import { LinkedInBotClient } from "./LinkedInBotClient";

// The bot that runs the AI Anchor company Page on LinkedIn: two posts a
// day and a slide video once a week (posted on their own), plus comment
// drafts for other companies' posts (posted by hand). Owner only.
export default async function LinkedInBotPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  await requireAppOwnerPage();
  const { error, connected } = await searchParams;
  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/dashboard/admin" className="text-xs font-medium text-slate-400 hover:text-brand">
          ← Admin
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">LinkedIn bot</h1>
        <p className="mt-1 text-sm text-slate-500">
          Writes and publishes the AI Anchor Page&apos;s posts every day and a slide video every week, and drafts smart
          comments for other companies&apos; posts for you to post.
        </p>
      </div>
      <LinkedInBotClient
        initialError={error ?? null}
        justConnected={connected === "1"}
        callbackUrl={`${process.env.AUTH_URL || "https://YOUR-APP.onrender.com"}/api/admin/linkedin-bot/callback`}
      />
    </div>
  );
}
