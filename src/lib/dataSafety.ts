import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  answerPlaybook,
  contactNotes,
  dataChangeLog,
  deals,
  meetingParticipants,
  meetings,
  summaries,
  tasks,
  teams,
  transcripts,
} from "@/db/schema";

// Nothing in Anchor is ever really erased by a person's click. A deleted
// deal moves, with everything attached to it (calls, files, notes, tasks),
// to a hidden "trash" team that has no members, so it disappears from
// everyone's view but can be put back from Admin → Find a person /
// Deleted deals. Every deal query is scoped to the viewer's team, which
// is what makes the trash team invisible without changing them all.
export const TRASH_TEAM_NAME = "Deleted deals (Anchor trash)";

export async function trashTeamId(): Promise<string> {
  const [existing] = await db.select({ id: teams.id }).from(teams).where(eq(teams.name, TRASH_TEAM_NAME)).limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(teams)
    .values({ name: TRASH_TEAM_NAME, ownerUserId: null, billingExempt: true })
    .returning({ id: teams.id });
  return created.id;
}

// Moves a deal and the rows that carry a team id of their own along with it.
async function moveDeal(dealId: string, toTeamId: string): Promise<void> {
  await db.update(deals).set({ teamId: toTeamId }).where(eq(deals.id, dealId));
  await db.update(tasks).set({ teamId: toTeamId }).where(eq(tasks.dealId, dealId));
  await db.update(answerPlaybook).set({ teamId: toTeamId }).where(eq(answerPlaybook.dealId, dealId));
}

export async function trashDeal(dealId: string): Promise<void> {
  await moveDeal(dealId, await trashTeamId());
}

// Puts a deleted deal back on the team it was deleted from.
export async function restoreDeal(dealId: string): Promise<{ ok: true; teamId: string } | { ok: false; error: string }> {
  const [deal] = await db.select({ teamId: deals.teamId }).from(deals).where(eq(deals.id, dealId));
  if (!deal) return { ok: false, error: "That deal no longer exists." };
  const trash = await trashTeamId();
  if (deal.teamId !== trash) return { ok: false, error: "That deal isn't deleted." };
  const [entry] = await db
    .select({ teamId: dataChangeLog.teamId })
    .from(dataChangeLog)
    .where(and(eq(dataChangeLog.action, "deal_deleted"), eq(dataChangeLog.targetId, dealId)))
    .orderBy(desc(dataChangeLog.createdAt))
    .limit(1);
  const teamId = entry?.teamId;
  if (!teamId) return { ok: false, error: "Couldn't tell which team it came from." };
  const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));
  if (!team) return { ok: false, error: "Its team no longer exists." };
  await moveDeal(dealId, teamId);
  return { ok: true, teamId };
}

// A full copy of a call before it's deleted (the meeting, its transcripts,
// summaries and participants), kept in the change log so it can be put
// back. The recording file itself is no longer deleted from storage.
export async function meetingSnapshot(meetingId: string): Promise<Record<string, unknown>> {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  const [t, s, p] = await Promise.all([
    db.select().from(transcripts).where(eq(transcripts.meetingId, meetingId)),
    db.select().from(summaries).where(eq(summaries.meetingId, meetingId)),
    db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId)),
  ]);
  return { meeting, transcripts: t, summaries: s, participants: p };
}

export async function contactNotesSnapshot(contactId: string) {
  return db.select().from(contactNotes).where(eq(contactNotes.contactId, contactId));
}
