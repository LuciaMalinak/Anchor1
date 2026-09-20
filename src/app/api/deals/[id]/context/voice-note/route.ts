import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorizeDeal } from "@/lib/dealAccess";
import { transcribeAudioFile } from "@/lib/transcribe";
import { appendDealNoteEntry } from "@/lib/dealNotes";

// Voice notes recorded from the "Give Anchor more context" box (Before
// tab) — transcribed and folded straight into deals.notes, the same
// field the "type it in" mode writes to and every AI touchpoint already
// reads (see dealFilesContext.ts's callers). The raw audio itself is
// NOT kept: this is meant to feel like talking instead of typing, not
// another recording archive, so there's nothing worth the storage cost
// once the words are captured.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — a few minutes of voice, not a full meeting

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

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No audio received" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That recording is empty" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Recording is too long (15MB max)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let transcript: string;
  try {
    const result = await transcribeAudioFile(buffer);
    transcript = result.fullText.trim();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't transcribe that recording." },
      { status: 502 }
    );
  }

  if (!transcript) {
    return NextResponse.json(
      { error: "No speech was detected in that recording." },
      { status: 400 }
    );
  }

  const updatedNotes = appendDealNoteEntry(deal.notes, "Voice note", transcript);

  await db
    .update(deals)
    .set({ notes: updatedNotes, updatedAt: new Date() })
    .where(eq(deals.id, dealId));

  return NextResponse.json({ notes: updatedNotes, transcript });
}
