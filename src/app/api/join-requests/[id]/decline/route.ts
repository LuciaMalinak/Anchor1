import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { joinRequests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTeamId } from "@/lib/team";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const teamId = await getOrCreateTeamId(session.user.id);

  const [request] = await db.select().from(joinRequests).where(eq(joinRequests.id, id));
  if (!request || request.teamId !== teamId) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (request.status !== "pending") {
    return NextResponse.json({ error: "Already decided" }, { status: 400 });
  }

  await db
    .update(joinRequests)
    .set({ status: "declined", decidedByUserId: session.user.id, decidedAt: new Date() })
    .where(eq(joinRequests.id, id));

  return NextResponse.json({ ok: true });
}
