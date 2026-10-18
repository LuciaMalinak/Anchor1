import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings, users } from "@/db/schema";
import { authenticateBearer } from "@/lib/apiToken";
import { normalizeSpeaker } from "@/lib/callIdentity";

const MAX_CALL_NAMES = 20;

// The live panel's "That's me" / "Not me": records which speaker label on
// calls is the signed-in person (users.callNames), so Anchor stops
// answering their own questions, on this call and every later one. Marking
// a speaker as you also clears the questions they "asked" from this call.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  // The desktop app's live panel is signed in with its token instead.
  const userId = session?.user?.id ?? (await authenticateBearer(req));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  const [meeting] = await db.select({ userId: meetings.userId }).from(meetings).where(eq(meetings.id, id));
  if (!meeting || meeting.userId !== userId) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const speakerName = typeof body.speakerName === "string" ? body.speakerName.trim().slice(0, 120) : "";
  const isMe = body.isMe !== false;
  if (!normalizeSpeaker(speakerName)) return NextResponse.json({ error: "No speaker given" }, { status: 400 });

  const [user] = await db.select({ callNames: users.callNames }).from(users).where(eq(users.id, userId));
  const key = normalizeSpeaker(speakerName);
  const others = (user?.callNames ?? []).filter((n) => normalizeSpeaker(n) !== key);
  const callNames = isMe ? [...others, speakerName].slice(-MAX_CALL_NAMES) : others;
  await db.update(users).set({ callNames }).where(eq(users.id, userId));

  if (isMe) {
    await db
      .update(meetings)
      .set({
        liveQuestions: sql`(
          select coalesce(jsonb_agg(q order by (q->>'askedAt')::bigint), '[]'::jsonb)
          from jsonb_array_elements(coalesce(${meetings.liveQuestions}, '[]'::jsonb)) q
          where coalesce(q->>'askedBy', '') <> ${speakerName}
        )`,
        liveSuggestions: sql`case
          when ${meetings.liveSuggestions}->'liveQuestion'->>'askedBy' = ${speakerName}
          then ${meetings.liveSuggestions} || '{"liveQuestion":null}'::jsonb
          else ${meetings.liveSuggestions} end`,
      })
      .where(eq(meetings.id, id));
  }
  return NextResponse.json({ ok: true, callNames });
}
