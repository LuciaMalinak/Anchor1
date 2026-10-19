import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { answerPlaybook } from "@/db/schema";
import { invalidatePlaybook } from "@/lib/answerPlaybook";
import { entryIfAllowed } from "@/lib/playbookAccess";

// Edit an entry: it becomes "taught" — a person's answer, which Anchor
// trusts over anything learned from a call.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const found = await entryIfAllowed(session.user.id, id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : found.entry.question;
  const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 2000) : found.entry.answer;
  if (!question || !answer) return NextResponse.json({ error: "Write both the question and the answer." }, { status: 400 });
  const [entry] = await db
    .update(answerPlaybook)
    .set({ question, answer, source: "taught", userId: session.user.id, updatedAt: new Date() })
    .where(eq(answerPlaybook.id, id))
    .returning();
  invalidatePlaybook(found.access.teamId);
  return NextResponse.json({ entry });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const found = await entryIfAllowed(session.user.id, id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(answerPlaybook).where(eq(answerPlaybook.id, id));
  invalidatePlaybook(found.access.teamId);
  return NextResponse.json({ ok: true });
}
