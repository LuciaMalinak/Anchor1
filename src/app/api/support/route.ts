import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { supportRequests } from "@/db/schema";
import { notifySupport } from "@/lib/support";

// The signed-in person's own "Get help" request (SupportButton.tsx):
// GET their current open one, POST a new one. See src/lib/support.ts.

export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [request] = await db
    .select()
    .from(supportRequests)
    .where(
      and(
        eq(supportRequests.userId, session.user.id),
        ne(supportRequests.status, "resolved"),
      ),
    )
    .orderBy(desc(supportRequests.createdAt))
    .limit(1);
  return NextResponse.json({ request: request ?? null });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const message =
    typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (!message)
    return NextResponse.json(
      { error: "Tell us what you need help with." },
      { status: 400 },
    );
  const pageUrl =
    typeof body.pageUrl === "string" ? body.pageUrl.slice(0, 500) : null;

  const [request] = await db
    .insert(supportRequests)
    .values({ userId: session.user.id, message, pageUrl })
    .returning();

  const origin = process.env.AUTH_URL || req.nextUrl.origin;
  await notifySupport({
    kind: "new",
    who: session.user.name || session.user.email || "Someone",
    message,
    adminUrl: `${origin}/dashboard/admin#support`,
  });
  return NextResponse.json({ request });
}
