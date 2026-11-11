import { and, eq, inArray, isNotNull, lt, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { dataChangeLog, meetings, teams, users } from "@/db/schema";
import { deleteMeetingAudio } from "@/lib/storage";
import { deleteRecallCopy } from "@/lib/recall";
import { logDataChange } from "@/lib/dataChangeLog";

// Automatic deletion, set by the team owner on the Team page: calls older
// than the team's retentionDays are deleted for good — the recording in
// storage, any copy left at Recall.ai, the transcript, summary,
// participants and contact notes (they cascade with the meeting row), and
// the recovery copy kept when someone deleted a call by hand. Unlike a
// manual delete, no recovery copy is kept: that's the point.

export const RETENTION_CHOICES = [30, 60, 90, 180, 365] as const;

const LIVE = ["joining", "recording", "transcribing", "summarizing"] as const;

export async function purgeExpiredCalls(): Promise<{ teams: number; calls: number }> {
  const withRetention = await db
    .select({ id: teams.id, days: teams.retentionDays })
    .from(teams)
    .where(isNotNull(teams.retentionDays));
  let calls = 0;
  let touched = 0;
  for (const team of withRetention) {
    if (!team.days || team.days < 1) continue;
    const cutoff = new Date(Date.now() - team.days * 86_400_000);
    const members = await db.select({ id: users.id }).from(users).where(eq(users.teamId, team.id));
    const ids = members.map((m) => m.id);
    if (!ids.length) continue;
    const old = await db
      .select({ id: meetings.id, recallBotId: meetings.recallBotId, recallRecordingId: meetings.recallRecordingId })
      .from(meetings)
      .where(and(inArray(meetings.userId, ids), lt(meetings.occurredAt, cutoff), notInArray(meetings.status, [...LIVE])));
    for (const m of old) {
      try {
        await deleteMeetingAudio(m.id);
        await deleteRecallCopy(m);
        await db.delete(meetings).where(eq(meetings.id, m.id));
        calls++;
      } catch (err) {
        console.error(`[retention] couldn't delete call ${m.id}:`, err);
      }
    }
    // Recovery copies of calls deleted by hand, older than the window.
    await db
      .delete(dataChangeLog)
      .where(and(eq(dataChangeLog.action, "meeting_deleted"), inArray(dataChangeLog.actorUserId, ids), lt(dataChangeLog.createdAt, cutoff)));
    if (old.length) {
      touched++;
      await logDataChange({ action: "calls_auto_deleted", teamId: team.id, details: { count: old.length, days: team.days } });
    }
  }
  return { teams: touched, calls };
}
