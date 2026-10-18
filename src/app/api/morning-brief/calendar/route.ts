import { NextResponse } from "next/server";
import { isProviderConfigured } from "@/lib/integrations/config";
import { NeedsGooglePermissionError } from "@/lib/integrations/google";
import { createCalendarEvent } from "@/lib/integrations/calendarEvent";
import { endISO } from "@/lib/suggestInvites";
import { safeTimeZone } from "@/lib/timeZone";
import { briefActor, loadBriefEmail, saveBriefEmail, validThreadId } from "@/lib/briefActions";

// A meeting the Morning brief suggested from an email (someone asked to
// meet or proposed a time): "decline" sets it aside; "google" adds it to
// Google Calendar, optionally inviting the person who wrote. Nothing goes
// in a calendar until one of these is clicked. (Apple Calendar is the
// .ics file from ./ics.)
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const userId = await briefActor(body.token);
  if (!userId) return NextResponse.json({ error: "This link has expired. Open today's brief instead." }, { status: 401 });
  const threadId = validThreadId(body.threadId);
  if (!threadId) return NextResponse.json({ error: "Nothing to add." }, { status: 400 });
  const { brief, email, shown } = await loadBriefEmail(userId, threadId);
  const meeting = email?.meeting;
  if (!brief || !email || !meeting) return NextResponse.json({ error: "That meeting isn't in your latest brief." }, { status: 404 });

  if (body.action === "decline") {
    await saveBriefEmail(userId, brief, shown, threadId, {
      email: { meeting: { ...meeting, declined: true } },
      shown: { meetingDeclined: true },
    });
    return NextResponse.json({ ok: true });
  }

  if (!isProviderConfigured("google")) return NextResponse.json({ error: "Google isn't set up on this server yet." }, { status: 503 });
  try {
    const start = `${meeting.start}:00`;
    const result = await createCalendarEvent(userId, {
      title: meeting.title,
      description: `About: ${email.subject}\n\nSuggested by Anchor from ${email.fromName}'s email.`,
      startISO: start,
      endISO: endISO(start, meeting.durationMinutes),
      timeZone: safeTimeZone(meeting.timeZone),
      attendees: body.invite === true ? [email.fromEmail] : [],
      addMeetLink: true,
      sendInvites: body.invite === true,
    });
    await saveBriefEmail(userId, brief, shown, threadId, {
      email: { meeting: { ...meeting, added: true, declined: false } },
      shown: { meetingAdded: true, meetingDeclined: false },
    });
    return NextResponse.json({ ok: true, openUrl: result.openUrl });
  } catch (err) {
    if (err instanceof NeedsGooglePermissionError) {
      const returnTo = typeof body.token === "string" ? `/brief/${body.token}?item=${threadId}` : "/dashboard";
      return NextResponse.json(
        {
          error: "needs_google_permission",
          connectUrl: `/api/integrations/google/connect?add=${err.scopeKey}&returnTo=${encodeURIComponent(returnTo)}`,
        },
        { status: 403 }
      );
    }
    console.error("[morning-brief calendar]", err);
    return NextResponse.json({ error: "Couldn't add it to your calendar. Try again." }, { status: 502 });
  }
}
