import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { meetingProposals } from "@/db/schema";
import { briefActor, loadBriefEmail, saveBriefEmail, validThreadId } from "@/lib/briefActions";
import { parseAddress } from "@/lib/integrations/gmailHeaders";
import { NeedsGooglePermissionError } from "@/lib/integrations/google";
import { NeedsConnectionError } from "@/lib/integrations/onlineMeetings";
import { isValidTimeZone } from "@/lib/morningBriefPrefs";
import { platformOptions, scheduleMeeting, type MeetingPlatform } from "@/lib/meetingScheduler";

// Setting up a meeting someone asked for, by email (from the Morning
// brief, id = Gmail thread id) or Slack (id = meeting proposal id):
// GET fills the form (who's on the thread, the proposed time, which ways
// to meet are available), POST creates it in the calendar with the video
// link and sends everyone the invitation, or declines it.

type Source = "email" | "slack";
type Draft = {
  fromName: string;
  title: string;
  reason: string;
  start: string | null;
  durationMinutes: number;
  timeZone: string;
  attendees: { name: string; email: string }[];
  status: "open" | "added" | "declined";
};

const PLATFORMS: MeetingPlatform[] = ["google_meet", "zoom", "teams", "in_person"];

async function load(userId: string, source: Source, id: string) {
  if (source === "email") {
    const threadId = validThreadId(id);
    if (!threadId) return null;
    const { brief, email, shown } = await loadBriefEmail(userId, threadId);
    if (!brief || !email?.meeting) return null;
    const people = [`${email.fromName} <${email.fromEmail}>`, ...(email.replyAll?.to ?? []), ...(email.replyAll?.cc ?? [])].map(parseAddress);
    const seen = new Set<string>();
    const draft: Draft = {
      fromName: email.fromName,
      title: email.meeting.title,
      reason: `From ${email.fromName}'s email: ${email.subject}`,
      start: email.meeting.start,
      durationMinutes: email.meeting.durationMinutes,
      timeZone: email.meeting.timeZone,
      attendees: people.filter((p) => !seen.has(p.email) && seen.add(p.email)),
      status: email.meeting.added ? "added" : email.meeting.declined ? "declined" : "open",
    };
    const done = async (state: { added?: boolean; declined?: boolean }) =>
      saveBriefEmail(userId, brief, shown, threadId, {
        email: { meeting: { ...email.meeting!, added: Boolean(state.added), declined: Boolean(state.declined) } },
        shown: { meetingAdded: Boolean(state.added), meetingDeclined: Boolean(state.declined) },
      });
    return { draft, subject: email.subject, done };
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await db
    .select()
    .from(meetingProposals)
    .where(and(eq(meetingProposals.id, id), eq(meetingProposals.userId, userId)));
  if (!p || p.status === "none") return null;
  const draft: Draft = {
    fromName: p.fromName,
    title: p.title,
    reason: p.reason,
    start: p.start,
    durationMinutes: p.durationMinutes,
    timeZone: p.timeZone,
    attendees: p.attendees.map((a) => ({ name: a.name ?? a.email, email: a.email })),
    status: p.status === "scheduled" ? "added" : p.status === "dismissed" ? "declined" : "open",
  };
  const done = async (state: { added?: boolean; declined?: boolean; result?: Record<string, unknown> }) =>
    db
      .update(meetingProposals)
      .set({ status: state.added ? "scheduled" : "dismissed", result: state.result ?? null, updatedAt: new Date() })
      .where(eq(meetingProposals.id, p.id));
  return { draft, subject: `Slack with ${p.fromName}`, done };
}

function source(v: unknown): Source | null {
  return v === "email" || v === "slack" ? v : null;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const userId = await briefActor(q.get("token"));
  if (!userId) return NextResponse.json({ error: "Sign in to Anchor first." }, { status: 401 });
  const src = source(q.get("source"));
  const found = src ? await load(userId, src, q.get("id") ?? "") : null;
  if (!found) return NextResponse.json({ error: "That meeting request isn't here anymore." }, { status: 404 });
  const returnTo = q.get("returnTo")?.startsWith("/") ? q.get("returnTo")! : "/dashboard";
  return NextResponse.json({ ...found.draft, options: await platformOptions(userId, returnTo) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const userId = await briefActor(body.token);
  if (!userId) return NextResponse.json({ error: "Sign in to Anchor first." }, { status: 401 });
  const src = source(body.source);
  const found = src ? await load(userId, src, String(body.id ?? "")) : null;
  if (!found) return NextResponse.json({ error: "That meeting request isn't here anymore." }, { status: 404 });

  if (body.action === "decline") {
    await found.done({ declined: true });
    return NextResponse.json({ ok: true });
  }

  const platform = PLATFORMS.find((p) => p === body.platform);
  const start = typeof body.start === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.start) ? body.start : null;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : found.draft.title;
  const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : found.draft.timeZone;
  const durationMinutes = Math.min(480, Math.max(10, Number(body.durationMinutes) || found.draft.durationMinutes));
  const attendees = Array.isArray(body.attendees) ? body.attendees.filter((a: unknown): a is string => typeof a === "string") : [];
  if (!platform) return NextResponse.json({ error: "Pick how you'll meet." }, { status: 400 });
  if (!start) return NextResponse.json({ error: "Pick a day and time." }, { status: 400 });
  if (platform === "in_person" && !(typeof body.location === "string" && body.location.trim())) {
    return NextResponse.json({ error: "Add where you'll meet." }, { status: 400 });
  }

  try {
    const result = await scheduleMeeting(userId, {
      platform,
      title,
      description: `${found.draft.reason}\n\nSet up with Anchor.`,
      start,
      durationMinutes,
      timeZone,
      attendees,
      location: typeof body.location === "string" ? body.location.slice(0, 300) : undefined,
    });
    await found.done({ added: true, result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("/") ? body.returnTo : "/dashboard";
    if (err instanceof NeedsGooglePermissionError) {
      return NextResponse.json(
        {
          error: "Anchor needs permission to add events to your Google Calendar.",
          connectUrl: `/api/integrations/google/connect?add=${err.scopeKey}&returnTo=${encodeURIComponent(returnTo)}`,
        },
        { status: 403 }
      );
    }
    if (err instanceof NeedsConnectionError) {
      return NextResponse.json(
        { error: err.message, connectUrl: `/api/integrations/${err.provider}/connect?returnTo=${encodeURIComponent(returnTo)}` },
        { status: 403 }
      );
    }
    console.error("[schedule-meeting]", err);
    return NextResponse.json({ error: "Couldn't set up the meeting. Try again." }, { status: 502 });
  }
}
