import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { supportRequests } from "@/db/schema";
import { normalizeAccessCode, notifySupport } from "@/lib/support";

// The person updating their own request: add (or replace) their Chrome
// Remote Desktop access code, or close the request themselves.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const [existing] = await db
    .select()
    .from(supportRequests)
    .where(
      and(
        eq(supportRequests.id, id),
        eq(supportRequests.userId, session.user.id),
      ),
    );
  if (!existing)
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (existing.status === "resolved")
    return NextResponse.json(
      { error: "This request is already closed." },
      { status: 400 },
    );

  const body = await req.json().catch(() => ({}));
  if (body.status === "resolved") {
    const [request] = await db
      .update(supportRequests)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(supportRequests.id, id))
      .returning();
    return NextResponse.json({ request });
  }

  const accessCode = normalizeAccessCode(body.accessCode);
  if (!accessCode) {
    return NextResponse.json(
      { error: "That doesn't look like a 12-digit access code." },
      { status: 400 },
    );
  }
  const [request] = await db
    .update(supportRequests)
    .set({ accessCode, accessCodeAt: new Date(), updatedAt: new Date() })
    .where(eq(supportRequests.id, id))
    .returning();

  const origin = process.env.AUTH_URL || req.nextUrl.origin;
  await notifySupport({
    kind: "code",
    who: session.user.name || session.user.email || "Someone",
    message: existing.message,
    accessCode,
    adminUrl: `${origin}/dashboard/admin#support`,
  });
  return NextResponse.json({ request });
}
