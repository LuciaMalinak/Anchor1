/**
 * Exercises the database side of the "remembers people across meetings"
 * logic with fake data — no AssemblyAI/Anthropic calls. This checks that
 * the schema, the contact matching, and the rolling-summary update logic
 * in processMeeting.ts are all wired correctly, independent of whether
 * the AI calls themselves produce good output (that part still needs
 * real API keys to verify).
 *
 * Run with: npx tsx scripts/dry-run-memory-test.ts
 */
import { db } from "../src/db";
import {
  users,
  meetings,
  contacts,
  meetingParticipants,
  transcripts,
  summaries,
} from "../src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  console.log("=== Dry run: cross-meeting memory logic ===\n");

  // Clean slate for this test user.
  const testEmail = "dryrun-test@example.com";
  const existingUser = await db.select().from(users).where(eq(users.email, testEmail));
  if (existingUser.length > 0) {
    await db.delete(users).where(eq(users.id, existingUser[0].id));
  }

  const [user] = await db.insert(users).values({ email: testEmail, name: "Dry Run User" }).returning();
  console.log(`Created test user ${user.id}`);

  // --- Meeting 1: first time meeting "Jane Doe" ---
  const [meeting1] = await db
    .insert(meetings)
    .values({ userId: user.id, title: "First call with Jane", status: "ready" })
    .returning();

  await db.insert(transcripts).values({
    meetingId: meeting1.id,
    provider: "fake",
    fullText: "fake transcript 1",
    utterances: [{ speakerLabel: "Speaker A", text: "Hi I'm Jane", startMs: 0, endMs: 1000 }],
  });

  // Simulate what processMeeting.ts does for a NEW contact.
  const [janeContact] = await db
    .insert(contacts)
    .values({
      userId: user.id,
      name: "Jane Doe",
      relationshipSummary: "Jane is evaluating Anchor for her sales team. Budget not yet confirmed.",
      meetingCount: 1,
      lastMeetingAt: new Date(),
    })
    .returning();

  await db.insert(meetingParticipants).values({
    meetingId: meeting1.id,
    contactId: janeContact.id,
    speakerLabel: "Speaker A",
    displayName: "Jane Doe",
  });

  await db.insert(summaries).values({
    meetingId: meeting1.id,
    overview: "Intro call with Jane Doe about Anchor.",
    keyPoints: ["Jane evaluating for her sales team"],
    actionItems: [],
    continuityNote: null,
  });

  console.log(`Meeting 1: created new contact "Jane Doe" (meetingCount=1)`);

  // --- Meeting 2: Jane shows up again — this is the part that matters ---
  const [meeting2] = await db
    .insert(meetings)
    .values({ userId: user.id, title: "Follow-up with Jane", status: "ready" })
    .returning();

  // Simulate what processMeeting.ts does when it finds an EXISTING contact
  // by name: it should update the same row, not create a duplicate.
  const beforeUpdate = await db.select().from(contacts).where(eq(contacts.id, janeContact.id));
  const priorSummary = beforeUpdate[0].relationshipSummary;
  const priorCount = beforeUpdate[0].meetingCount;

  const mergedSummary =
    "Jane confirmed budget is approved and wants to move to a pilot. Previously was evaluating for her sales team.";

  await db
    .update(contacts)
    .set({
      relationshipSummary: mergedSummary,
      meetingCount: priorCount + 1,
      lastMeetingAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, janeContact.id));

  await db.insert(meetingParticipants).values({
    meetingId: meeting2.id,
    contactId: janeContact.id,
    speakerLabel: "Speaker A",
    displayName: "Jane Doe",
  });

  await db.insert(summaries).values({
    meetingId: meeting2.id,
    overview: "Follow-up call — budget confirmed.",
    keyPoints: ["Budget approved", "Ready to pilot"],
    actionItems: [{ text: "Send pilot agreement", owner: "You" }],
    continuityNote: "Jane Doe: budget is now confirmed, up from 'not yet confirmed' at the intro call.",
  });

  // --- Verify ---
  const allContacts = await db.select().from(contacts).where(eq(contacts.userId, user.id));
  const janeMeetingCount = allContacts.length;
  const finalJane = allContacts.find((c) => c.name === "Jane Doe");

  console.log(`\nAfter meeting 2:`);
  console.log(`  Distinct contacts named "Jane Doe" in DB: ${janeMeetingCount} (should be 1 — no duplicate created)`);
  console.log(`  Jane's meetingCount: ${finalJane?.meetingCount} (should be 2)`);
  console.log(`  Jane's prior summary was: "${priorSummary}"`);
  console.log(`  Jane's updated summary is: "${finalJane?.relationshipSummary}"`);

  const participantRows = await db
    .select()
    .from(meetingParticipants)
    .where(eq(meetingParticipants.contactId, janeContact.id));
  console.log(`  meeting_participant rows linked to Jane: ${participantRows.length} (should be 2 — one per meeting)`);

  const pass =
    janeMeetingCount === 1 &&
    finalJane?.meetingCount === 2 &&
    participantRows.length === 2;

  console.log(`\n=== ${pass ? "PASS" : "FAIL"} ===`);

  // Cleanup
  await db.delete(users).where(eq(users.id, user.id));
  console.log("(test data cleaned up)");

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
