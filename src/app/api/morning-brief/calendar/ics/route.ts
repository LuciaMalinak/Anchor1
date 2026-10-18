import { NextRequest, NextResponse } from "next/server";
import { briefActor, loadBriefEmail, saveBriefEmail, validThreadId, zonedToUtc } from "@/lib/briefActions";

// The suggested meeting as a calendar file: opening it adds the event to
// Apple Calendar on a Mac, iPhone or iPad (or Outlook). Counts as approved.
function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const userId = await briefActor(token);
  if (!userId) return NextResponse.json({ error: "This link has expired." }, { status: 401 });
  const threadId = validThreadId(req.nextUrl.searchParams.get("threadId"));
  if (!threadId) return NextResponse.json({ error: "Nothing to add." }, { status: 400 });
  const { brief, email, shown } = await loadBriefEmail(userId, threadId);
  const meeting = email?.meeting;
  if (!brief || !email || !meeting) return NextResponse.json({ error: "That meeting isn't in your latest brief." }, { status: 404 });

  const start = zonedToUtc(meeting.start, meeting.timeZone);
  const end = new Date(start.getTime() + meeting.durationMinutes * 60_000);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Anchor//Morning brief//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${threadId}-${meeting.start.replace(/\D/g, "")}@anchor`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(meeting.title)}`,
    `DESCRIPTION:${icsText(`About: ${email.subject}\nSuggested by Anchor from ${email.fromName}'s email.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  await saveBriefEmail(userId, brief, shown, threadId, {
    email: { meeting: { ...meeting, added: true, declined: false } },
    shown: { meetingAdded: true, meetingDeclined: false },
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${meeting.title.replace(/[^\w -]+/g, "").trim() || "meeting"}.ics"`,
    },
  });
}
