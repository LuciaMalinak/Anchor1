import { NextResponse } from "next/server";
import { desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { supportRequests, teams, users } from "@/db/schema";
import { requireAppOwnerApi } from "@/lib/adminAccess";

// Support requests for the app owner (AdminSupportRequests.tsx): every open
// or in-progress one, plus the most recently resolved, newest first.
export async function GET() {
  const admin = await requireAppOwnerApi();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const select = {
    id: supportRequests.id,
    message: supportRequests.message,
    pageUrl: supportRequests.pageUrl,
    accessCode: supportRequests.accessCode,
    accessCodeAt: supportRequests.accessCodeAt,
    status: supportRequests.status,
    createdAt: supportRequests.createdAt,
    resolvedAt: supportRequests.resolvedAt,
    userName: users.name,
    userEmail: users.email,
    teamId: users.teamId,
    teamName: teams.name,
  };
  const base = () =>
    db
      .select(select)
      .from(supportRequests)
      .innerJoin(users, eq(users.id, supportRequests.userId))
      .leftJoin(teams, eq(teams.id, users.teamId));

  const [active, resolved] = await Promise.all([
    base()
      .where(ne(supportRequests.status, "resolved"))
      .orderBy(desc(supportRequests.createdAt)),
    base()
      .where(eq(supportRequests.status, "resolved"))
      .orderBy(desc(supportRequests.resolvedAt))
      .limit(10),
  ]);
  return NextResponse.json({ active, resolved });
}
