import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { tasks, deals } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";
import { getHomeTasks } from "@/lib/homeTasks";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);
  const homeTasks = await getHomeTasks({ teamId });
  return NextResponse.json({ tasks: homeTasks });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "Enter what needs doing" }, { status: 400 });
  }
  if (text.length > 500) {
    return NextResponse.json({ error: "Keep it under 500 characters" }, { status: 400 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);

  let dealId: string | null = null;
  if (typeof body.dealId === "string" && body.dealId) {
    const [deal] = await db
      .select()
      .from(deals)
      .where(and(eq(deals.id, body.dealId), eq(deals.teamId, teamId)));
    if (!deal) {
      return NextResponse.json({ error: "That deal wasn't found" }, { status: 400 });
    }
    dealId = deal.id;
  }

  const ownerLabel =
    typeof body.ownerLabel === "string" && body.ownerLabel.trim() ? body.ownerLabel.trim() : null;

  const [task] = await db
    .insert(tasks)
    .values({
      teamId,
      dealId,
      text,
      ownerLabel,
      source: "manual",
      createdByUserId: session.user.id,
    })
    .returning();

  return NextResponse.json({ task }, { status: 201 });
}
