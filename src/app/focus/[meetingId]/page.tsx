import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, deals, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canAccessDeal } from "@/lib/dealAccess";
import { resolveFocusWidgets } from "@/lib/focusWidgets";
import { FocusWindow } from "./FocusWindow";

// The standalone focus-mode window — opened via window.open from the
// "Focus window" button on a live meeting (see openFocusWindow in
// src/lib/focusWindow.ts, called from LiveMeetingPanel.tsx). Deliberately
// its own top-level route (outside /dashboard) rather than nested under
// it: nesting would inherit dashboard/layout.tsx's header, nav, and
// footer, which is exactly the chrome this page exists to NOT show — a
// popped-out window on a second monitor next to the real call has no use
// for a "Deals / Insights / Contacts" nav bar.
export default async function FocusPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const { meetingId } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();

  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) notFound();

  // Same visibility rule as the full meeting detail page (see
  // src/app/dashboard/meetings/[id]/page.tsx): the person who owns this
  // meeting, or anyone who can see the deal it's attached to.
  const isOwner = meeting.userId === session.user.id;
  let deal: typeof deals.$inferSelect | null = null;
  if (meeting.dealId) {
    const [d] = await db.select().from(deals).where(eq(deals.id, meeting.dealId));
    deal = d ?? null;
  }
  const sharedViaTeam =
    !isOwner && deal ? await canAccessDeal(session.user.id, deal.id, deal.teamId, deal) : false;
  if (!isOwner && !sharedViaTeam) notFound();

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
  const initialWidgets = resolveFocusWidgets(user?.focusWidgets ?? null);

  return (
    <FocusWindow
      meetingId={meeting.id}
      meetingTitle={meeting.title}
      dealId={deal?.id ?? null}
      dealName={deal?.name ?? null}
      stage={deal?.stage ?? null}
      primaryContactName={deal?.primaryContactName ?? null}
      primaryContactRole={deal?.primaryContactRole ?? null}
      decisionBoundaries={deal?.decisionBoundaries ?? null}
      initialWidgets={initialWidgets}
    />
  );
}
