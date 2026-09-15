import { auth } from "@/auth";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { DashboardClient } from "./DashboardClient";

export default async function DashboardPage() {
  const session = await auth();
  const rows = session?.user?.id
    ? await db
        .select()
        .from(meetings)
        .where(eq(meetings.userId, session.user.id))
        .orderBy(desc(meetings.createdAt))
    : [];

  const serializable = rows.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    errorMessage: m.errorMessage,
    createdAt: m.createdAt.toISOString(),
  }));

  return <DashboardClient initialMeetings={serializable} />;
}
