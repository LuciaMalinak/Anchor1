import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { authorizeMeeting } from "@/lib/meetingAccess";
import { isProviderConfigured } from "@/lib/integrations/config";
import { NeedsGooglePermissionError } from "@/lib/integrations/google";
import { createCalendarEvent } from "@/lib/integrations/calendarEvent";
import { endISO } from "@/lib/suggestInvites";
import { safeTimeZone } from "@/lib/timeZone";

const Body = z.object({
  title: z.string().min(3).max(120),
  startISO: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/),
  durationMinutes: z.number().int().min(15).max(240),
  timeZone: z.string().max(64),
  attendees: z.array(z.string().email()).max(20),
  sourceQuote: z.string().max(300).optional(),
  sendInvites: z.boolean(),
});

// Adds one suggested follow-up meeting (from suggested-invites) to the
// user's Google Calendar. Only called when they click "Add to calendar".
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await authorizeMeeting(session.user.id, id))) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  if (!isProviderConfigured("google")) {
    return NextResponse.json({ error: "Google isn't set up on this server yet." }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That invite is missing something." }, { status: 400 });
  }
  const d = parsed.data;
  const start = d.startISO.length === 16 ? `${d.startISO}:00` : d.startISO;

  try {
    const result = await createCalendarEvent(session.user.id, {
      title: d.title,
      description: d.sourceQuote
        ? `Agreed in the call: "${d.sourceQuote}"\n\nSuggested by Anchor.`
        : "Suggested by Anchor.",
      startISO: start,
      endISO: endISO(start, d.durationMinutes),
      timeZone: safeTimeZone(d.timeZone),
      attendees: d.attendees,
      addMeetLink: true,
      sendInvites: d.sendInvites && d.attendees.length > 0,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NeedsGooglePermissionError) {
      return NextResponse.json(
        {
          error: "needs_google_permission",
          connectUrl: `/api/integrations/google/connect?add=${err.scopeKey}&returnTo=${encodeURIComponent(`/dashboard/meetings/${id}`)}`,
        },
        { status: 403 }
      );
    }
    console.error("[calendar-event]", err);
    return NextResponse.json({ error: "Couldn't add it to your calendar. Try again." }, { status: 502 });
  }
}
