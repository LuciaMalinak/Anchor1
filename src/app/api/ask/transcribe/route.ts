import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { withAiUser } from "@/lib/aiUsage";
import { transcribeShortClip } from "@/lib/transcribe";

// Turns a recorded spoken question into text for Ask Anchor's mic, for
// browsers without built-in speech recognition. Body: the raw audio.
const MAX_BYTES = 8 * 1024 * 1024; // about 2–4 minutes of compressed audio

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const audio = Buffer.from(await req.arrayBuffer());
  if (audio.length === 0) return NextResponse.json({ error: "No audio was recorded." }, { status: 400 });
  if (audio.length > MAX_BYTES) return NextResponse.json({ error: "That's too long for a question. Try a shorter one." }, { status: 413 });
  try {
    const text = await withAiUser({ userId: session.user.id }, () => transcribeShortClip(audio));
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[ask/transcribe] failed:", err);
    return NextResponse.json({ error: "Couldn't make out the question. Try again or type it." }, { status: 502 });
  }
}

export const maxDuration = 60;
