import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, meetings } from "@/db/schema";
import { desc, eq, count } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);
  const rows = await db
    .select({
      id: deals.id,
      name: deals.name,
      createdAt: deals.createdAt,
      meetingCount: count(meetings.id),
    })
    .from(deals)
    .leftJoin(meetings, eq(meetings.dealId, deals.id))
    .where(eq(deals.teamId, teamId))
    .groupBy(deals.id)
    .orderBy(desc(deals.updatedAt));

  return NextResponse.json({ deals: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Give the deal a name" }, { status: 400 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);
  const [deal] = await db
    .insert(deals)
    .values({ teamId, name, createdByUserId: session.user.id })
    .returning();

  return NextResponse.json({ deal }, { status: 201 });
}
