import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { tasks, taskComments, users } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";

async function authorizeTask(userId: string, taskId: string) {
  const teamId = await getOrCreateTeamId(userId);
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task || task.teamId !== teamId) return null;
  return task;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: taskId } = await params;
  const task = await authorizeTask(session.user.id, taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const rows = await db
    .select({ comment: taskComments, author: users })
    .from(taskComments)
    .innerJoin(users, eq(taskComments.userId, users.id))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt));

  return NextResponse.json({
    comments: rows.map((r) => ({
      id: r.comment.id,
      content: r.comment.content,
      createdAt: r.comment.createdAt.toISOString(),
      author: { id: r.author.id, name: r.author.name, email: r.author.email, image: r.author.image },
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: taskId } = await params;
  const task = await authorizeTask(session.user.id, taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const content = String(body.content || "").trim();
  if (!content) {
    return NextResponse.json({ error: "Comment can't be empty" }, { status: 400 });
  }
  if (content.length > 2000) {
    return NextResponse.json({ error: "Keep it under 2000 characters" }, { status: 400 });
  }

  const [comment] = await db
    .insert(taskComments)
    .values({ taskId, userId: session.user.id, content })
    .returning();

  return NextResponse.json({
    comment: {
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
      author: {
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? "",
        image: session.user.image ?? null,
      },
    },
  });
}
