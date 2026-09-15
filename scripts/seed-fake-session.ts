/**
 * Creates a fake signed-in session + a fully "ready" meeting with a
 * transcript, summary, and a returning contact, so the dashboard and
 * meeting-detail pages can be rendered and checked without needing real
 * AssemblyAI/Anthropic calls or a real email sign-in.
 *
 * Run with: npx tsx scripts/seed-fake-session.ts
 * Prints a cookie value to use with curl.
 */
import { randomUUID } from "crypto";
import { db } from "../src/db";
import {
  users,
  sessions,
  meetings,
  contacts,
  meetingParticipants,
  transcripts,
  summaries,
} from "../src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const email = "uitest@example.com";
  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length > 0) {
    await db.delete(users).where(eq(users.id, existing[0].id));
  }

  const [user] = await db.insert(users).values({ email, name: "UI Test" }).returning();

  const sessionToken = randomUUID();
  await db.insert(sessions).values({
    sessionToken,
    userId: user.id,
    expires: new Date(Date.now() + 1000 * 60 * 60),
  });

  const [contact] = await db
    .insert(contacts)
    .values({
      userId: user.id,
      name: "Jane Doe",
      relationshipSummary:
        "Jane confirmed budget is approved and wants to move to a pilot. Previously was evaluating for her sales team.",
      meetingCount: 2,
      lastMeetingAt: new Date(),
    })
    .returning();

  const [meeting] = await db
    .insert(meetings)
    .values({
      userId: user.id,
      title: "Follow-up with Jane",
      status: "ready",
      audioFileName: "fake.mp3",
    })
    .returning();

  await db.insert(transcripts).values({
    meetingId: meeting.id,
    provider: "fake",
    fullText: "Hi Jane, thanks for joining. ... Budget is approved on our end.",
    utterances: [
      { speakerLabel: "Speaker A", text: "Hi Jane, thanks for joining.", startMs: 0, endMs: 2000 },
      { speakerLabel: "Speaker B", text: "Of course. Budget is approved on our end.", startMs: 2000, endMs: 5000 },
    ],
  });

  await db.insert(summaries).values({
    meetingId: meeting.id,
    overview: "Follow-up call with Jane Doe — budget confirmed, moving to a pilot.",
    keyPoints: ["Budget approved on Jane's side", "Ready to move to a pilot"],
    actionItems: [{ text: "Send pilot agreement", owner: "You" }],
    continuityNote: "Jane Doe: budget is now confirmed, up from 'not yet confirmed' at the intro call.",
  });

  await db.insert(meetingParticipants).values([
    { meetingId: meeting.id, contactId: null, speakerLabel: "Speaker A", displayName: null },
    { meetingId: meeting.id, contactId: contact.id, speakerLabel: "Speaker B", displayName: "Jane Doe" },
  ]);

  console.log("COOKIE_NAME=authjs.session-token");
  console.log(`COOKIE_VALUE=${sessionToken}`);
  console.log(`MEETING_ID=${meeting.id}`);
  console.log(`USER_ID=${user.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
