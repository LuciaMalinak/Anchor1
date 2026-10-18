import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { morningBriefs } from "@/db/schema";
import { readBriefToken } from "@/lib/briefLink";
import { getBriefRow } from "@/lib/morningBrief";
import type { BriefSnapshot, ShownState } from "@/lib/morningBriefRender";
import { isProviderConfigured } from "@/lib/integrations/config";
import { NeedsGooglePermissionError } from "@/lib/integrations/google";
import { createCalendarEvent } from "@/lib/integrations/calendarEvent";
import { endISO } from "@/lib/suggestInvites";
import { safeTimeZone } from "@/lib/timeZone";

// "Add to calendar" on a meeting the Morning brief suggested from an
// email (someone asked to meet or proposed a time). Nothing goes in the
// calendar until this is clicked. Uses the meeting as saved in the brief,
// not anything sent with the request. Works from the brief's own link
// (token) without signing in, or signed in.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const session = await auth();
  const token = typeof body.token === "string" ? body.token : null;
  const fromToken = token ? readBriefToken(token) : null;
  const userId = fromToken?.userId ?? session?.user?.id;
  if (!userId) return NextResponse.json({ error: "This link has expired. Open today's brief instead." }, { status: 401 });
  const threadId = typeof body.threadId === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(body.threadId) ? body.threadId : null;
  if (!threadId) return NextResponse.json({ error: "Nothing to add." }, { status: 400 });
  if (!isProviderConfigured("google")) return NextResponse.json({ error: "Google isn't set up on this server yet." }, { status: 503 });

  const row = await getBriefRow(userId);
  const brief = (row?.lastBrief ?? null) as BriefSnapshot | null;
  const email = brief?.emails.find((e) => e.threadId === threadId);
  const meeting = email?.meeting;
  if (!brief || !email || !meeting) return NextResponse.json({ error: "That meeting isn't in your latest brief." }, { status: 404 });

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
    meeting.added = true;
    const shown = { ...((row?.shown as ShownState) ?? {}) };
    if (shown[threadId]) shown[threadId] = { ...shown[threadId], meetingAdded: true };
    await db
      .update(morningBriefs)
      .set({ lastBrief: brief as unknown as Record<string, unknown>, shown, updatedAt: new Date() })
      .where(eq(morningBriefs.userId, userId));
    return NextResponse.json({ ok: true, openUrl: result.openUrl });
  } catch (err) {
    if (err instanceof NeedsGooglePermissionError) {
      const returnTo = token ? `/brief/${token}?item=${threadId}` : "/dashboard";
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
