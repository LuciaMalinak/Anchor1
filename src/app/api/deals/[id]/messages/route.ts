import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { dealMessages, users } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { authorizeDeal } from "@/lib/dealAccess";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const authorized = await authorizeDeal(session.user.id, dealId);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const rows = await db
    .select({ message: dealMessages, author: users })
    .from(dealMessages)
    .innerJoin(users, eq(dealMessages.userId, users.id))
    .where(eq(dealMessages.dealId, dealId))
    .orderBy(asc(dealMessages.createdAt));

  return NextResponse.json({
    messages: rows.map((r) => ({
      id: r.message.id,
      content: r.message.content,
      createdAt: r.message.createdAt.toISOString(),
      author: { id: r.author.id, name: r.author.name, email: r.author.email, image: r.author.image },
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const authorized = await authorizeDeal(session.user.id, dealId);
  if (!authorized) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const content = String(body.content || "").trim();
  if (!content) {
    return NextResponse.json({ error: "Message can't be empty" }, { status: 400 });
  }
  if (content.length > 4000) {
    return NextResponse.json({ error: "Message is too long" }, { status: 400 });
  }

  const [message] = await db
    .insert(dealMessages)
    .values({ dealId, userId: session.user.id, content })
    .returning();

  return NextResponse.json({
    message: {
      id: message.id,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      author: {
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? "",
        image: session.user.image ?? null,
      },
    },
  });
}
