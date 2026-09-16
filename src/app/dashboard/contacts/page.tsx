import { auth } from "@/auth";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ContactsClient } from "./ContactsClient";

export default async function ContactsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, session.user.id))
    .orderBy(desc(contacts.lastMeetingAt));

  return (
    <ContactsClient
      initialContacts={rows.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        role: c.role,
        relationshipSummary: c.relationshipSummary,
        meetingCount: c.meetingCount,
      }))}
    />
  );
}
