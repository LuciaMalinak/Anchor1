import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorizeDeal } from "@/lib/dealAccess";
import { authenticateBearer } from "@/lib/apiToken";

// The desktop app's "to do for this deal" panel — shown alongside a live
// or just-finished recording once it's matched to a deal (see
// /api/desktop/deals/match-now). Deliberately scoped to ONE deal, unlike
// the team-wide src/lib/homeTasks.ts this otherwise mirrors (open tasks,
// oldest first): the desktop window is about the account someone's on
// the phone with right now, not their whole book of business.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await authenticateBearer(req);
  if (!userId) {
    return NextResponse.json({ error: "Invalid or missing desktop token" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const authz = await authorizeDeal(userId, dealId);
  if (!authz) {
    return NextResponse.json({ error: "That deal wasn't found" }, { status: 404 });
  }

  const openTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.dealId, dealId), eq(tasks.completed, false)))
    .orderBy(asc(tasks.createdAt));

  return NextResponse.json({ tasks: openTasks });
}
