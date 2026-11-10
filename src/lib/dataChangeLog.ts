import { db } from "@/db";
import { dataChangeLog } from "@/db/schema";

export type DataChange = {
  action:
    | "deal_deleted"
    | "deal_restored"
    | "member_removed"
    | "account_deleted"
    | "team_deleted"
    | "user_moved"
    | "user_restored"
    | "deals_rebuilt"
    | "deals_rebuild_preview"
    | "meeting_deleted"
    | "file_deleted"
    | "message_deleted"
    | "contact_deleted";
  actorUserId?: string | null;
  actorEmail?: string | null;
  teamId?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
};

// Records a change that removes or moves someone's data (see the
// data_change_log table). Never blocks the change itself: a failure here
// is logged loudly instead.
export async function logDataChange(change: DataChange): Promise<void> {
  try {
    await db.insert(dataChangeLog).values({
      action: change.action,
      actorUserId: change.actorUserId ?? null,
      actorEmail: change.actorEmail ?? null,
      teamId: change.teamId ?? null,
      targetId: change.targetId ?? null,
      details: change.details ?? null,
    });
  } catch (err) {
    console.error("[dataChangeLog] couldn't record a change:", change, err);
  }
}
