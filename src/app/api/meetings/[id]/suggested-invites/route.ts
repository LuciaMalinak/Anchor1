import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { transcripts, summaries, meetingParticipants, contacts } from "@/db/schema";
import { authorizeMeeting } from "@/lib/meetingAccess";
import { suggestInvites } from "@/lib/suggestInvites";
import { findFollowUpMeetingsText } from "@/lib/summarize";
import { localDateISO, localNowISO, safeTimeZone } from "@/lib/timeZone";

const Body = z.object({ timeZone: z.string().max(64).optional() });

// Finds follow-up meetings people agreed to in this call ("let's review
// Friday"). Suggestions only: nothing touches anyone's calendar until the
// user clicks "Add to calendar" (see calendar-event). Not persisted, same
// as follow-up-draft.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  const access = await authorizeMeeting(session.user.id, id);
  if (!access) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  if (access.meeting.status !== "ready") {
    return NextResponse.json({ error: "This meeting hasn't finished processing yet" }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const timeZone = safeTimeZone(parsed.success ? parsed.data.timeZone : null);

  const [transcript] = await db.select().from(transcripts).where(eq(transcripts.meetingId, id));
  if (!transcript) {
    return NextResponse.json({ error: "No transcript available for this meeting" }, { status: 400 });
  }
  const [summary] = await db.select().from(summaries).where(eq(summaries.meetingId, id));
  const people = await db
    .select({
      speakerLabel: meetingParticipants.speakerLabel,
      displayName: meetingParticipants.displayName,
      email: contacts.email,
    })
    .from(meetingParticipants)
    .leftJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
    .where(eq(meetingParticipants.meetingId, id));

  const nameByLabel = new Map(people.map((p) => [p.speakerLabel, p.displayName || p.speakerLabel]));
  const text = transcript.utterances?.length
    ? transcript.utterances.map((u) => `${nameByLabel.get(u.speakerLabel) ?? u.speakerLabel}: ${u.text}`).join("\n")
    : transcript.fullText;

  const participants = people.map((p) => ({
    name: p.displayName || p.speakerLabel,
    ...(p.email ? { email: p.email } : {}),
  }));
  // Same fallback follow-up-draft uses for recipients.
  if (access.deal?.primaryContactEmail && !participants.some((p) => p.email === access.deal!.primaryContactEmail)) {
    participants.push({ name: access.deal.name, email: access.deal.primaryContactEmail });
  }

  try {
    const suggestions = await suggestInvites(
      {
        transcript: text,
        actionItems: (summary?.actionItems ?? []).map((a) => (a.owner ? `${a.text} (${a.owner})` : a.text)),
        meetingDateISO: localDateISO(access.meeting.occurredAt, timeZone),
        timeZone,
        participants,
      },
      findFollowUpMeetingsText
    );
    // Opened days after the call? Don't offer invites that have already passed.
    const now = localNowISO(timeZone);
    return NextResponse.json({
      suggestions: suggestions.filter((s) => s.startISO.slice(0, 16) > now),
      timeZone,
    });
  } catch (err) {
    console.error("[suggested-invites]", err);
    return NextResponse.json({ error: "Couldn't look for follow-up meetings. Try again." }, { status: 502 });
  }
}
