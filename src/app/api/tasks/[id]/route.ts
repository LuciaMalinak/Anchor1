import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const teamId = await getOrCreateTeamId(session.user.id);

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task || task.teamId !== teamId) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.completed !== "boolean") {
    return NextResponse.json({ error: "Missing 'completed'" }, { status: 400 });
  }

  const [updated] = await db
    .update(tasks)
    .set({
      completed: body.completed,
      completedAt: body.completed ? new Date() : null,
      completedByUserId: body.completed ? session.user.id : null,
    })
    .where(eq(tasks.id, id))
    .returning();

  return NextResponse.json({ task: updated });
}
