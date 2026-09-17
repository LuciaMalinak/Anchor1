import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// Flips the one-time welcome splash off for good, right after it plays
// on the dashboard — see WelcomeSplash.tsx.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  await db.update(users).set({ welcomeSeen: true }).where(eq(users.id, session.user.id));
  return NextResponse.json({ ok: true });
}
