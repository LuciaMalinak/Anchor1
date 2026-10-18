import { NextResponse } from "next/server";
import { autoDraftReplies } from "@/lib/morningBrief";
import { briefActor } from "@/lib/briefActions";

// "Draft my replies now": puts a reply in Gmail drafts for every email
// waiting on this person, straight away, and says exactly what it did —
// which Google account, what it drafted, what it skipped and why.
// Works signed in (Profile) or from the brief's own link (token).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const userId = await briefActor(body.token);
  if (!userId) return NextResponse.json({ error: "This link has expired. Open today's brief instead." }, { status: 401 });
  try {
    return NextResponse.json(await autoDraftReplies(userId, { everything: true }));
  } catch (err) {
    console.error("[draft-now]", err);
    return NextResponse.json({ error: `Couldn't draft replies: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}

export const maxDuration = 180;
