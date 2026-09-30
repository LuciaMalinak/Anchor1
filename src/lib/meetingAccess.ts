import { eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings, deals } from "@/db/schema";
import { canAccessDeal } from "@/lib/dealAccess";

// Same rule as the meeting page and /api/meetings/[id]/follow-up-draft: the
// meeting's creator, or anyone who can see the deal it's attached to. The
// deal is only returned when this user can actually see it, since an older
// meeting can still carry a dealId from another team.
export async function authorizeMeeting(userId: string, meetingId: string) {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) return null;

  let deal: typeof deals.$inferSelect | null = null;
  if (meeting.dealId) {
    const [d] = await db.select().from(deals).where(eq(deals.id, meeting.dealId));
    if (d && (await canAccessDeal(userId, meeting.dealId, d.teamId, d))) deal = d;
  }
  if (meeting.userId !== userId && !deal) return null;
  return { meeting, deal };
}
