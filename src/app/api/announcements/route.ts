import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { announcements, teams, users } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";

const MAX_CONTENT_LENGTH = 2000;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);

  const rows = await db
    .select({ announcement: announcements, author: users })
    .from(announcements)
    .innerJoin(users, eq(announcements.authorUserId, users.id))
    .where(eq(announcements.teamId, teamId))
    .orderBy(desc(announcements.createdAt))
    .limit(20);

  return NextResponse.json({
    announcements: rows.map((r) => ({
      id: r.announcement.id,
      content: r.announcement.content,
      createdAt: r.announcement.createdAt.toISOString(),
      author: { id: r.author.id, name: r.author.name, email: r.author.email, image: r.author.image },
    })),
  });
}

// Owner-only — same "leadership" bar as removing a teammate or deleting
// a whole deal (see /api/team/members/[id]/route.ts). A small team is
// exactly the kind of place a loosely-defined "leadership team" could
// otherwise mean "anyone," so this ties it to something concrete that
// already exists: whoever owns the team.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const teamId = await getOrCreateTeamId(session.user.id);
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team || team.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "Only the team owner can post announcements" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const content = String(body.content || "").trim();
  if (!content) {
    return NextResponse.json({ error: "Write something first" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json({ error: "That's too long" }, { status: 400 });
  }

  const [created] = await db
    .insert(announcements)
    .values({ teamId, authorUserId: session.user.id, content })
    .returning();

  return NextResponse.json({
    announcement: {
      id: created.id,
      content: created.content,
      createdAt: created.createdAt.toISOString(),
      author: {
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? "",
        image: session.user.image ?? null,
      },
    },
  });
}
