import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { dataChangeLog, users } from "@/db/schema";
import { logDataChange, type DataChange } from "@/lib/dataChangeLog";

// The team's activity log: who signed in, opened, shared, exported,
// deleted or changed what. Stored in data_change_log with the team's id,
// and shown to the team owner on the Team page (and as a CSV download),
// so a client's IT or legal team can see exactly who touched their data.

// Opening the same call or deal again within this window isn't logged
// twice, so the log stays readable.
const VIEW_DEDUPE_MS = 10 * 60_000;

export async function logTeamActivity(
  userId: string,
  action: DataChange["action"],
  targetId?: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    const [user] = await db.select({ email: users.email, teamId: users.teamId }).from(users).where(eq(users.id, userId));
    if (!user?.teamId) return;
    if (action.endsWith("_viewed") && targetId) {
      const [recent] = await db
        .select({ id: dataChangeLog.id })
        .from(dataChangeLog)
        .where(
          and(
            eq(dataChangeLog.actorUserId, userId),
            eq(dataChangeLog.action, action),
            eq(dataChangeLog.targetId, targetId),
            gt(dataChangeLog.createdAt, new Date(Date.now() - VIEW_DEDUPE_MS)),
          ),
        )
        .limit(1);
      if (recent) return;
    }
    await logDataChange({ action, actorUserId: userId, actorEmail: user.email, teamId: user.teamId, targetId, details });
  } catch (err) {
    console.error("[activityLog] couldn't record activity:", action, err);
  }
}

const LABELS: Record<string, string> = {
  signed_in: "Signed in",
  meeting_viewed: "Opened a call",
  deal_viewed: "Opened a deal",
  deal_share_link_created: "Created a share link for a deal",
  team_exported: "Downloaded all of the team's data",
  meeting_deleted: "Deleted a call",
  deal_deleted: "Deleted a deal",
  deal_restored: "Restored a deal",
  file_deleted: "Deleted a file",
  message_deleted: "Deleted a message",
  contact_deleted: "Deleted a contact",
  member_removed: "Removed someone from the team",
  member_signed_out: "Signed someone out everywhere",
  two_factor_enabled: "Turned on two-step verification",
  two_factor_disabled: "Turned off two-step verification",
  team_two_factor_required: "Required two-step verification for everyone",
  team_two_factor_optional: "Made two-step verification optional",
  retention_changed: "Changed automatic deletion",
  do_not_record_changed: "Changed the do-not-record list",
  calls_auto_deleted: "Old calls deleted automatically",
  recording_blocked: "Recording blocked by the do-not-record list",
};

// Only these keys of a row's details are ever shown: some rows (a deleted
// call, say) keep a full recovery copy in details, which never leaves the
// server through the activity log.
const SAFE_DETAIL_KEYS = ["title", "name", "dealName", "email", "days", "count", "entries", "matched", "via", "ip"];

export type ActivityRow = { at: string; who: string; action: string; what: string };

export async function teamActivity(teamId: string, limit = 500): Promise<ActivityRow[]> {
  const members = await db.select({ id: users.id }).from(users).where(eq(users.teamId, teamId));
  const memberIds = members.map((m) => m.id);
  const rows = await db
    .select({
      action: dataChangeLog.action,
      actorEmail: dataChangeLog.actorEmail,
      details: dataChangeLog.details,
      createdAt: dataChangeLog.createdAt,
    })
    .from(dataChangeLog)
    .where(
      memberIds.length
        ? or(eq(dataChangeLog.teamId, teamId), inArray(dataChangeLog.actorUserId, memberIds))
        : eq(dataChangeLog.teamId, teamId),
    )
    .orderBy(desc(dataChangeLog.createdAt))
    .limit(limit);
  return rows
    .filter((r) => LABELS[r.action])
    .map((r) => {
      const d = (r.details ?? {}) as Record<string, unknown>;
      const meeting = d.meeting as { title?: string } | undefined;
      const parts = SAFE_DETAIL_KEYS.filter((k) => d[k] != null && d[k] !== "").map((k) =>
        Array.isArray(d[k]) ? (d[k] as unknown[]).join(", ") : String(d[k]),
      );
      if (meeting?.title) parts.unshift(meeting.title);
      let what = parts.join(" · ");
      if (r.action === "calls_auto_deleted") what = `${d.count} call${d.count === 1 ? "" : "s"} older than ${d.days} days`;
      if (r.action === "retention_changed") what = typeof d.days === "number" ? `Delete after ${d.days} days` : "Keep until deleted";
      if (r.action === "recording_blocked") what = `${d.title ? `"${d.title}" ` : ""}matched "${d.matched}" (${d.via})`;
      if (r.action === "do_not_record_changed") what = Array.isArray(d.entries) && d.entries.length ? (d.entries as string[]).join(", ") : "List cleared";
      return {
        at: r.createdAt.toISOString(),
        who: r.actorEmail ?? "Anchor.AI",
        action: LABELS[r.action],
        what,
      };
    });
}

export function activityCsv(rows: ActivityRow[]): string {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return ["When (UTC),Who,Action,Details", ...rows.map((r) => [r.at, r.who, r.action, r.what].map(cell).join(","))].join("\n");
}
