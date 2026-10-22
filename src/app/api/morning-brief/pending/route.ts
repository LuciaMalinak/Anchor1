import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetingProposals } from "@/db/schema";
import { getBriefRow } from "@/lib/morningBrief";
import { meetingWhen, type BriefSnapshot } from "@/lib/morningBriefRender";

// Meetings someone asked for that haven't been set up or declined yet —
// the little pop-ups across Anchor (MeetingSuggestionPopups): from emails
// in the latest Morning brief (from the last 3 days), and from Slack DMs
// (meetingProposals.ts, from the last week).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ meetings: [] });
  const [row, slack] = await Promise.all([
    getBriefRow(session.user.id),
    db
      .select()
      .from(meetingProposals)
      .where(and(eq(meetingProposals.userId, session.user.id), eq(meetingProposals.status, "open")))
      .orderBy(desc(meetingProposals.createdAt))
      .limit(5),
  ]);
  const brief = (row?.lastBrief ?? null) as BriefSnapshot | null;
  const fresh = brief && Date.now() - Date.parse(`${brief.date}T00:00:00Z`) <= 3 * 86_400_000;
  const fromEmail = fresh
    ? brief.emails
        .filter((e) => e.meeting && !e.meeting.added && !e.meeting.declined && (row?.dismissed ?? {})[e.threadId] !== "done")
        .map((e) => ({
          source: "email" as const,
          id: e.threadId,
          fromName: e.fromName,
          deal: e.deal,
          title: e.meeting!.title,
          when: meetingWhen(e.meeting!),
        }))
    : [];
  const fromSlack = slack
    .filter((p) => Date.now() - p.createdAt.getTime() <= 7 * 86_400_000)
    .map((p) => ({
      source: "slack" as const,
      id: p.id,
      fromName: p.fromName,
      deal: null,
      title: p.title,
      when: p.start ? meetingWhen({ start: p.start, durationMinutes: p.durationMinutes }) : "pick a time",
    }));
  return NextResponse.json({ meetings: [...fromEmail, ...fromSlack] });
}
