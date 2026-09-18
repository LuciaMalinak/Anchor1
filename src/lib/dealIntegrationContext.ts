// Pulls the "digs into all material" gap closed: Gmail and Calendar
// connections have existed since the Integrations page shipped, but
// nothing ever actually read from them — deal context only ever came
// from meetings, files, and notes. This is what makes a connection
// actually feed Ask Anchor and handoff briefings, not just sit there.
//
// Whose connection gets used: the deal's lead if they're connected,
// falling back to whoever created the deal — never a random teammate's
// personal inbox just because they happen to be viewing the page. If
// neither has Google connected, this quietly does nothing, same as
// today.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, meetingParticipants, meetings, contacts } from "@/db/schema";
import { fetchRelevantEmails } from "./integrations/gmail";
import { fetchRelevantEvents } from "./integrations/calendar";

// Same rhythm as companyResearch's STALE_AFTER_MS — frequent enough that
// a new email or an upcoming meeting shows up the same day, not so
// frequent that opening a deal page repeatedly hammers Gmail/Calendar.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export function isIntegrationContextStale(updatedAt: Date | null): boolean {
  if (!updatedAt) return true;
  return Date.now() - updatedAt.getTime() > STALE_AFTER_MS;
}

async function getDealParticipantEmails(dealId: string, primaryContactEmail: string | null): Promise<string[]> {
  const rows = await db
    .selectDistinct({ email: contacts.email })
    .from(meetingParticipants)
    .innerJoin(meetings, eq(meetingParticipants.meetingId, meetings.id))
    .innerJoin(contacts, eq(meetingParticipants.contactId, contacts.id))
    .where(eq(meetings.dealId, dealId));

  const emails = rows.map((r) => r.email).filter((e): e is string => Boolean(e));
  if (primaryContactEmail) emails.push(primaryContactEmail);
  return Array.from(new Set(emails));
}

export type IntegrationContextResult = { emailContext: string | null; calendarContext: string | null };

// Best-effort, never throws: a missing connection, a revoked token, or an
// API hiccup just means the deal goes on without this layer, exactly as
// it did before this existed. Returns null (rather than updating the
// row) when there's nothing to match against yet, so a brand-new deal
// with no resolved contacts doesn't overwrite anything with emptiness.
export async function refreshDealIntegrationContext(deal: {
  id: string;
  leadUserId: string | null;
  createdByUserId: string;
  primaryContactEmail: string | null;
}): Promise<IntegrationContextResult | null> {
  const candidateUserId = deal.leadUserId || deal.createdByUserId;

  try {
    const participantEmails = await getDealParticipantEmails(deal.id, deal.primaryContactEmail);
    if (participantEmails.length === 0) return null;

    const [emails, events] = await Promise.all([
      fetchRelevantEmails(candidateUserId, participantEmails).catch((err) => {
        console.error(`[dealIntegrationContext] gmail fetch failed for deal ${deal.id}:`, err);
        return [];
      }),
      fetchRelevantEvents(candidateUserId, participantEmails).catch((err) => {
        console.error(`[dealIntegrationContext] calendar fetch failed for deal ${deal.id}:`, err);
        return [];
      }),
    ]);

    const emailContext = emails.length
      ? emails.map((e) => `— ${e.subject} (from ${e.from}, ${e.date})\n${e.snippet}`).join("\n\n")
      : null;
    const calendarContext = events.length
      ? events
          .map((e) => `— ${e.summary} (${e.start})${e.attendees.length ? ` — attendees: ${e.attendees.join(", ")}` : ""}`)
          .join("\n")
      : null;

    await db
      .update(deals)
      .set({ emailContext, calendarContext, integrationContextUpdatedAt: new Date() })
      .where(eq(deals.id, deal.id));

    return { emailContext, calendarContext };
  } catch (err) {
    console.error(`[dealIntegrationContext] refresh failed for deal ${deal.id}:`, err);
    return null;
  }
}
