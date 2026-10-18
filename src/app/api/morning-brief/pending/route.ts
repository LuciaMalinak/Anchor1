import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getBriefRow } from "@/lib/morningBrief";
import { meetingWhen, type BriefSnapshot } from "@/lib/morningBriefRender";

// Meetings someone suggested by email (from the latest Morning brief) that
// haven't been approved or declined yet — the little pop-ups across
// Anchor (MeetingSuggestionPopups). Only for a brief from the last 3 days.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ meetings: [] });
  const row = await getBriefRow(session.user.id);
  const brief = (row?.lastBrief ?? null) as BriefSnapshot | null;
  if (!brief || Date.now() - Date.parse(`${brief.date}T00:00:00Z`) > 3 * 86_400_000) return NextResponse.json({ meetings: [] });
  const meetings = brief.emails
    .filter((e) => e.meeting && !e.meeting.added && !e.meeting.declined && (row?.dismissed ?? {})[e.threadId] !== "done")
    .map((e) => ({
      threadId: e.threadId,
      fromName: e.fromName,
      deal: e.deal,
      title: e.meeting!.title,
      when: meetingWhen(e.meeting!),
    }));
  return NextResponse.json({ meetings });
}
