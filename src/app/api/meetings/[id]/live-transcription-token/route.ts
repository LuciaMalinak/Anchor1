import { NextResponse } from "next/server";
import { AssemblyAI } from "assemblyai";
import { and, eq, ne } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { contacts, deals, meetingParticipants, meetings, users } from "@/db/schema";
import { canAccessDeal } from "@/lib/dealAccess";

// Hands the browser a short-lived AssemblyAI streaming token for an
// in-person recording's live transcript (see
// src/lib/liveStreamingTranscription.ts), so the browser can stream mic
// audio straight to AssemblyAI without ever seeing ASSEMBLYAI_API_KEY.
// AssemblyAI's live transcription is far more accurate than the
// browser's built-in speech recognition (which also only works in
// Chrome/Edge) and punctuates, which is what question detection keys on.
// Also returns key terms — the deal's name, company and people — so names
// that matter get spelled right.

// How long the browser has to open the session with this token
// (AssemblyAI allows at most 10 minutes).
const TOKEN_EXPIRES_IN_SECONDS = 600;
// How long one streaming session can run before the browser needs a new
// token (it reconnects on its own — see liveStreamingTranscription.ts).
const MAX_SESSION_SECONDS = 3 * 60 * 60;
const MAX_KEYTERMS = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    // The browser falls back to its own speech recognition.
    return NextResponse.json({ error: "Live transcription isn't configured" }, { status: 503 });
  }

  const { id } = await params;
  const [meeting] = await db
    .select({ id: meetings.id, userId: meetings.userId, status: meetings.status, dealId: meetings.dealId })
    .from(meetings)
    .where(eq(meetings.id, id));
  if (!meeting || meeting.userId !== userId) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  if (meeting.status !== "recording" && meeting.status !== "joining") {
    return NextResponse.json({ error: "This meeting isn't live" }, { status: 409 });
  }

  const [token, keyterms] = await Promise.all([
    new AssemblyAI({ apiKey }).streaming.createTemporaryToken({
      expires_in_seconds: TOKEN_EXPIRES_IN_SECONDS,
      max_session_duration_seconds: MAX_SESSION_SECONDS,
    }),
    loadKeyterms(userId, meeting.id, meeting.dealId).catch((err) => {
      // Nice to have — never block the live transcript over it.
      console.error(`[live transcription] couldn't load key terms for meeting ${meeting.id}:`, err);
      return [] as string[];
    }),
  ]);

  return NextResponse.json({ token, keyterms });
}

// Names that speech-to-text tends to mangle and that matter most in a
// sales call: the deal, the company, the people on it, and the rep.
async function loadKeyterms(userId: string, meetingId: string, dealId: string | null): Promise<string[]> {
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  const terms: (string | null | undefined)[] = [owner?.name];

  if (dealId) {
    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    if (deal && (await canAccessDeal(userId, deal.id, deal.teamId, deal))) {
      terms.push(deal.name, companyFromWebsite(deal.companyWebsite));
      const people = await db
        .selectDistinctOn([contacts.id], { name: contacts.name, company: contacts.company })
        .from(meetingParticipants)
        .innerJoin(meetings, eq(meetingParticipants.meetingId, meetings.id))
        .innerJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
        .where(and(eq(meetings.dealId, deal.id), ne(meetings.id, meetingId)));
      for (const p of people) terms.push(p.name, p.company);
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw?.trim().replace(/\s+/g, " ");
    // AssemblyAI caps each key term's length; very long "names" are
    // usually sentences that ended up in a name field anyway.
    if (!term || term.length > 50 || /^unknown|^speaker [a-z0-9]+$/i.test(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}

// "https://www.acme-robotics.com/" → "acme robotics"
function companyFromWebsite(website: string | null): string | null {
  if (!website) return null;
  try {
    const host = new URL(website.includes("://") ? website : `https://${website}`).hostname.replace(/^www\./, "");
    const name = host.split(".")[0];
    return name ? name.replace(/[-_]+/g, " ") : null;
  } catch {
    return null;
  }
}
