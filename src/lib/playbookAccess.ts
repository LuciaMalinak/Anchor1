import { eq } from "drizzle-orm";
import { db } from "@/db";
import { answerPlaybook, deals } from "@/db/schema";
import { accessibleDealIds, dealVisibilityWhere } from "@/lib/dealAccess";

// Who can see and change which playbook entries: anyone on the team for
// team-wide ones, and only people who can open the deal for that deal's.
export async function playbookAccess(userId: string) {
  const access = await accessibleDealIds(userId);
  if (!access) return null;
  const visible = await db.select({ id: deals.id, name: deals.name }).from(deals).where(dealVisibilityWhere(access));
  return { teamId: access.teamId, deals: visible, dealIds: new Set(visible.map((d) => d.id)) };
}

export async function entryIfAllowed(userId: string, entryId: string) {
  const access = await playbookAccess(userId);
  if (!access) return null;
  const [entry] = await db.select().from(answerPlaybook).where(eq(answerPlaybook.id, entryId));
  if (!entry || entry.teamId !== access.teamId) return null;
  if (entry.dealId && !access.dealIds.has(entry.dealId)) return null;
  return { entry, access };
}
