import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { adminAccessLogs } from "@/db/schema";
import { isAppOwner } from "@/lib/appOwner";

// Gate + audit trail for the founder/admin read-only account view under
// src/app/dashboard/admin/**. Two deliberate choices here, matching what
// was actually agreed with Lucia rather than a literal "let me look
// without anyone knowing":
//
// - Nothing here ever notifies the team being viewed, in the moment — no
//   banner, no email, no in-app indicator. That's the actual ask.
// - Every view still writes a permanent row to admin_access_log (who,
//   which team, what) before rendering anything. "Without them knowing"
//   is about not interrupting the customer in real time, not about there
//   being zero record anywhere that it happened — an access mechanism
//   with no audit trail at all is a real legal/trust liability given
//   these pages can reach other people's meeting transcripts, and it's
//   also just bad practice for Lucia's own accountability. See the
//   "How Anchor is administered" clause added to the Privacy page.
//
// requireAppOwnerPage() is for server-component pages (redirects on
// failure, since a page can't return a JSON error); requireAppOwnerApi()
// is the same check for API routes (returns null instead, so the caller
// can respond with a plain 404 — same "pretend this doesn't exist" shape
// every other not-found/not-authorized check in this app already uses).

export async function requireAppOwnerPage(): Promise<{ id: string; email: string }> {
  const session = await auth();
  if (!session?.user?.id || !isAppOwner(session.user.email)) {
    redirect("/dashboard");
  }
  return { id: session.user.id, email: session.user.email! };
}

export async function requireAppOwnerApi(): Promise<{ id: string; email: string } | null> {
  const session = await auth();
  if (!session?.user?.id || !isAppOwner(session.user.email)) {
    return null;
  }
  return { id: session.user.id, email: session.user.email! };
}

export async function logAdminAccess(adminUserId: string, targetTeamId: string, view: string) {
  try {
    await db.insert(adminAccessLogs).values({ adminUserId, targetTeamId, view });
  } catch (err) {
    // Best-effort — a logging failure (e.g. the migration route above
    // hasn't been run against this database yet) shouldn't be what blocks
    // Lucia from looking into an active customer issue. Loud in the
    // server log either way, so a persistently-failing log doesn't go
    // unnoticed for long.
    console.error("[admin] failed to record admin access log:", err);
  }
}
