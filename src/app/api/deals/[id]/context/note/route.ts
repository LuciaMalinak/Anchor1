import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorizeDeal } from "@/lib/dealAccess";
import { appendDealNoteEntry } from "@/lib/dealNotes";

const MAX_NOTE_CHARS = 5000;

// The "Type" mode of the Before tab's "Give Anchor more context" box —
// appends a dated entry to deals.notes, same as the voice-note route's
// transcript (see appendDealNoteEntry). Deliberately an append, not a
// PATCH-style overwrite: the box always hands back a blank field after
// saving, so there's nothing to directly edit or delete here — the only
// way to change what Anchor knows is to add something new (another note,
// a call that updates the deal's rolling memory, or a corrected file).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const authorized = await authorizeDeal(session.user.id, dealId);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const { deal } = authorized;

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Type something first." }, { status: 400 });
  }
  if (text.length > MAX_NOTE_CHARS) {
    return NextResponse.json(
      { error: `That's a lot — keep it under ${MAX_NOTE_CHARS.toLocaleString()} characters, or attach it as a file instead.` },
      { status: 400 }
    );
  }

  const updatedNotes = appendDealNoteEntry(deal.notes, "Note", text);

  await db
    .update(deals)
    .set({ notes: updatedNotes, updatedAt: new Date() })
    .where(eq(deals.id, dealId));

  return NextResponse.json({ notes: updatedNotes });
}
