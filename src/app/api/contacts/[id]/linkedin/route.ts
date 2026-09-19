import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { extractLinkedInProfile, MAX_PASTE_LENGTH } from "@/lib/linkedinExtract";

// Saves a contact's LinkedIn URL, and — if profile text was pasted in too —
// runs it through the AI extractor and folds the result (company, role,
// relationship summary) into the contact. This is the compliant substitute
// for "connect LinkedIn and auto-pull contact data": LinkedIn's API only
// ever exposes the signed-in user's own profile, and its terms explicitly
// forbid using member data to enrich CRM contacts even where access exists
// — so every bit of profile text handled here came from a person pasting
// it in themselves, never an automated pull from LinkedIn.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const linkedinUrl = typeof body.linkedinUrl === "string" ? body.linkedinUrl.trim() : "";
  const pastedText = typeof body.pastedText === "string" ? body.pastedText.trim() : "";

  if (!linkedinUrl && !pastedText) {
    return NextResponse.json({ error: "Add a LinkedIn URL or paste in some profile text first" }, { status: 400 });
  }
  if (linkedinUrl && !/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(linkedinUrl)) {
    return NextResponse.json({ error: "That doesn't look like a linkedin.com URL" }, { status: 400 });
  }
  if (pastedText.length > MAX_PASTE_LENGTH) {
    return NextResponse.json(
      { error: "That's a lot of text — trim it to the headline/About/Experience sections and try again" },
      { status: 400 }
    );
  }

  const updates: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  // Explicit "clear the field" (empty string) is allowed through as null;
  // leaving the input untouched sends the existing value right back, so
  // this never silently blanks a URL someone didn't mean to remove.
  if (body.linkedinUrl !== undefined) updates.linkedinUrl = linkedinUrl || null;

  if (pastedText) {
    let extracted;
    try {
      extracted = await extractLinkedInProfile({
        contactName: contact.name,
        pastedText,
        priorSummary: contact.relationshipSummary,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Couldn't read that profile text" },
        { status: 500 }
      );
    }
    if (extracted.company) updates.company = extracted.company;
    if (extracted.role) updates.role = extracted.role;
    if (extracted.summary) updates.relationshipSummary = extracted.summary;
  }

  const [updated] = await db.update(contacts).set(updates).where(eq(contacts.id, contactId)).returning();
  return NextResponse.json({ contact: updated });
}
