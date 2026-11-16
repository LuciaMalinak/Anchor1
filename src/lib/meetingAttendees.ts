import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { contacts, users } from "@/db/schema";
import { getGoogleConnection, googleGet } from "@/lib/integrations/google";
import { apiFetch, getConnection } from "@/lib/integrations/oauthConnection";
import { researchCompanyByDomain } from "@/lib/companyResearch";

// Who was invited to a recorded call, from the calendar invite, so every
// outside guest becomes a contact with their name, email and company:
// people are recognised by the invite, not only by what the transcript
// happens to say. Google Calendar or Outlook, whichever is connected.
// Teammates, the person themselves and meeting rooms are left out.

export type Invitee = { email: string; name: string | null };

// Personal email providers: the domain says nothing about the company.
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "yandex.com",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "mail.com", "zoho.com",
]);

const MATCH_BEFORE_MS = 45 * 60_000;
const MATCH_AFTER_MS = 30 * 60_000;

export function emailDomain(email: string): string | null {
  const d = email.split("@")[1]?.toLowerCase().trim();
  return d && !PERSONAL_DOMAINS.has(d) ? d : null;
}

// "jane.doe@acme.com" -> "Jane Doe" when the invite has no display name.
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0].replace(/\+.*$/, "");
  const words = local.split(/[._-]+/).filter((w) => /^[a-z]+$/i.test(w) && w.length > 1);
  if (!words.length) return email;
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

type Candidate = { title: string; start: number; end: number; invitees: Invitee[] };

function pickEvent(events: Candidate[], at: number, title: string | null): Candidate | null {
  const near = events.filter((e) => e.start <= at + MATCH_AFTER_MS && e.end >= at - MATCH_BEFORE_MS && e.invitees.length > 0);
  if (!near.length) return null;
  const t = (title ?? "").toLowerCase();
  const sameTitle = near.filter((e) => t && e.title && (t.includes(e.title.toLowerCase()) || e.title.toLowerCase().includes(t)));
  const pool = sameTitle.length ? sameTitle : near;
  return pool.sort((a, b) => Math.abs(a.start - at) - Math.abs(b.start - at))[0];
}

async function googleEvents(userId: string, at: number): Promise<Candidate[] | null> {
  const connection = await getGoogleConnection(userId);
  if (!connection || !(connection.scope ?? "").includes("calendar")) return null;
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=25` +
    `&timeMin=${encodeURIComponent(new Date(at - 3 * 3600_000).toISOString())}&timeMax=${encodeURIComponent(new Date(at + 3 * 3600_000).toISOString())}`;
  const { json } = await googleGet(connection, connection.accessToken, url);
  type Ev = {
    summary?: string;
    status?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean }[];
  };
  return ((Array.isArray(json.items) ? json.items : []) as Ev[])
    .filter((e) => e.status !== "cancelled" && e.start?.dateTime && e.end?.dateTime)
    .map((e) => ({
      title: e.summary ?? "",
      start: Date.parse(e.start!.dateTime!),
      end: Date.parse(e.end!.dateTime!),
      invitees: (e.attendees ?? [])
        .filter((a) => a.email && !a.self && !a.resource && !a.email.endsWith("resource.calendar.google.com"))
        .map((a) => ({ email: a.email!.toLowerCase(), name: a.displayName?.trim() || null })),
    }));
}

async function outlookEvents(userId: string, at: number): Promise<Candidate[] | null> {
  const connection = await getConnection(userId, "microsoft");
  if (!connection) return null;
  const url =
    `https://graph.microsoft.com/v1.0/me/calendarView?$top=25&$select=subject,start,end,attendees,organizer,isCancelled` +
    `&startDateTime=${encodeURIComponent(new Date(at - 3 * 3600_000).toISOString())}&endDateTime=${encodeURIComponent(new Date(at + 3 * 3600_000).toISOString())}`;
  const res = await apiFetch(connection, url, { headers: { Prefer: 'outlook.timezone="UTC"' } });
  if (!res.ok) return null;
  type Person = { emailAddress?: { address?: string; name?: string } };
  type Ev = {
    subject?: string;
    isCancelled?: boolean;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    organizer?: Person;
    attendees?: (Person & { type?: string })[];
  };
  const json = (await res.json()) as { value?: Ev[] };
  const self = (connection.externalAccountEmail ?? "").toLowerCase();
  const utc = (s: string) => Date.parse(/Z|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
  return (json.value ?? [])
    .filter((e) => !e.isCancelled && e.start?.dateTime && e.end?.dateTime)
    .map((e) => ({
      title: e.subject ?? "",
      start: utc(e.start!.dateTime!),
      end: utc(e.end!.dateTime!),
      invitees: [e.organizer, ...(e.attendees ?? []).filter((a) => a.type !== "resource")]
        .map((p) => p?.emailAddress)
        .filter((a): a is { address: string; name?: string } => Boolean(a?.address) && a!.address!.toLowerCase() !== self)
        .map((a) => ({ email: a.address.toLowerCase(), name: a.name?.trim() && a.name.trim() !== a.address ? a.name.trim() : null })),
    }));
}

// The outside guests on the calendar event a call belongs to.
export async function findInvitees(userId: string, meeting: { title: string | null; at: Date }): Promise<Invitee[]> {
  const at = meeting.at.getTime();
  const [google, outlook] = await Promise.all([
    googleEvents(userId, at).catch((err) => {
      console.error("[meetingAttendees] Google Calendar lookup failed:", err);
      return null;
    }),
    outlookEvents(userId, at).catch((err) => {
      console.error("[meetingAttendees] Outlook lookup failed:", err);
      return null;
    }),
  ]);
  const event = pickEvent([...(google ?? []), ...(outlook ?? [])], at, meeting.title);
  if (!event) return [];

  // Not the person, not their teammates.
  const [me] = await db.select({ email: users.email, teamId: users.teamId }).from(users).where(eq(users.id, userId));
  const team = me?.teamId ? await db.select({ email: users.email }).from(users).where(eq(users.teamId, me.teamId)) : [];
  const own = new Set([me?.email, ...team.map((t) => t.email)].filter(Boolean).map((e) => e!.toLowerCase()));
  const seen = new Set<string>();
  return event.invitees.filter((i) => {
    if (own.has(i.email) || seen.has(i.email) || /no-?reply|calendar-notification/i.test(i.email)) return false;
    seen.add(i.email);
    return true;
  });
}

// Each invitee as a contact: matched by email, then by a name with no
// email yet (filling the email in), otherwise created. Returns the
// contacts in the invitees' order.
export async function contactsForInvitees(userId: string, invitees: Invitee[]): Promise<(typeof contacts.$inferSelect)[]> {
  if (!invitees.length) return [];
  const emails = invitees.map((i) => i.email);
  const byEmail = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.userId, userId), inArray(sql`lower(${contacts.email})`, emails)));
  const out: (typeof contacts.$inferSelect)[] = [];
  for (const inv of invitees) {
    const found = byEmail.find((c) => c.email?.toLowerCase() === inv.email);
    if (found) {
      out.push(found);
      continue;
    }
    const name = inv.name ?? nameFromEmail(inv.email);
    const [sameName] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.userId, userId), isNull(contacts.email), sql`lower(${contacts.name}) = ${name.toLowerCase()}`))
      .limit(1);
    if (sameName) {
      const [updated] = await db
        .update(contacts)
        .set({ email: inv.email, updatedAt: new Date() })
        .where(eq(contacts.id, sameName.id))
        .returning();
      out.push(updated);
      continue;
    }
    const [created] = await db.insert(contacts).values({ userId, name, email: inv.email }).returning();
    out.push(created);
  }
  return out;
}

// The invited contact a speaker the summary named most likely is: same
// full name, or the only invitee with that first name.
export function matchSpeakerToInvitee<T extends { name: string }>(speakerName: string, invited: T[]): T | null {
  const s = speakerName.trim().toLowerCase();
  if (!s) return null;
  const full = invited.filter((c) => c.name.toLowerCase() === s);
  if (full.length === 1) return full[0];
  const first = s.split(/\s+/)[0];
  const byFirst = invited.filter((c) => c.name.toLowerCase().split(/\s+/)[0] === first);
  return byFirst.length === 1 ? byFirst[0] : null;
}

// Fills in company name and a short public briefing on the company for
// contacts with a work email, once per company domain (copied to other
// contacts at the same company). Company only, never the person.
const MAX_NEW_COMPANIES = 3;

export async function enrichContactCompanies(userId: string, contactIds: string[]): Promise<void> {
  if (!contactIds.length) return;
  const rows = await db.select().from(contacts).where(and(eq(contacts.userId, userId), inArray(contacts.id, contactIds)));
  const todo = rows.filter((c) => c.email && emailDomain(c.email) && !c.companyBriefing);
  const researched = new Map<string, { name: string | null; briefing: string }>();
  let fresh = 0;
  for (const c of todo) {
    const domain = emailDomain(c.email!)!;
    let info = researched.get(domain);
    if (!info) {
      const [known] = await db
        .select({ company: contacts.company, briefing: contacts.companyBriefing })
        .from(contacts)
        .where(and(eq(contacts.userId, userId), sql`lower(${contacts.email}) like ${"%@" + domain}`, sql`${contacts.companyBriefing} is not null`))
        .limit(1);
      if (known?.briefing) info = { name: known.company, briefing: known.briefing };
      else if (fresh < MAX_NEW_COMPANIES) {
        fresh++;
        info = await researchCompanyByDomain(domain).catch((err) => {
          console.error(`[meetingAttendees] couldn't research ${domain}:`, err);
          return undefined;
        });
      }
      if (info) researched.set(domain, info);
    }
    if (!info) continue;
    await db
      .update(contacts)
      .set({
        company: c.company || info.name,
        companyBriefing: info.briefing,
        companyBriefingAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, c.id));
  }
}
