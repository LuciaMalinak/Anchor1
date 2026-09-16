import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: contactId } = await params;
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact || contact.userId !== session.user.id) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.notes !== "string") {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(contacts)
    .set({ notes: body.notes.trim() || null, updatedAt: new Date() })
    .where(eq(contacts.id, contactId))
    .returning();

  return NextResponse.json({ contact: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: contactId } = await params;
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact || contact.userId !== session.user.id) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  // meeting_participant rows referencing this contact just lose the link
  // (onDelete: set null, see schema.ts) — past meeting summaries and
  // transcripts are untouched, Anchor just stops tracking history for them.
  await db.delete(contacts).where(eq(contacts.id, contactId));

  return NextResponse.json({ ok: true });
}
