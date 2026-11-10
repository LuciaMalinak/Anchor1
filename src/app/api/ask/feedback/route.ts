import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { rateAsk } from "@/lib/askMemory";

// Thumbs up / down on an Ask Anchor answer, with an optional note on what
// to do differently. Ask Anchor learns from it (src/lib/askMemory.ts).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { question?: unknown; rating?: unknown; note?: unknown };
  const question = typeof body.question === "string" ? body.question : "";
  const rating = body.rating === 1 ? 1 : body.rating === -1 ? -1 : null;
  if (!question.trim() || !rating) return NextResponse.json({ error: "Missing question or rating" }, { status: 400 });
  const saved = await rateAsk({
    userId: session.user.id,
    question,
    rating,
    note: typeof body.note === "string" ? body.note : null,
  });
  return NextResponse.json({ ok: saved });
}
