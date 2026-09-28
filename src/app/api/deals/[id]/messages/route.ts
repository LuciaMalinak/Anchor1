import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { dealMessages, users } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { authorizeDeal } from "@/lib/dealAccess";

// A message is visible to whoever's on this deal's team AND either: it
// has no recipientUserIds (the old default — whole team, unchanged), or
// this viewer sent it, or this viewer is named in recipientUserIds. Kept
// as a plain filter over already-authorized-for-the-deal rows rather
// than a WHERE clause, since jsonb array membership isn't something
// drizzle's query builder expresses cleanly and this table is small
// per deal.
function visibleTo(userId: string, message: { userId: string; recipientUserIds: string[] | null }): boolean {
  if (!message.recipientUserIds) return true;
  if (message.userId === userId) return true;
  return message.recipientUserIds.includes(userId);
}

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
    messages: rows
      .filter((r) => visibleTo(session.user.id!, r.message))
      .map((r) => ({
        id: r.message.id,
        content: r.message.content,
        createdAt: r.message.createdAt.toISOString(),
        author: { id: r.author.id, name: r.author.name, email: r.author.email, image: r.author.image },
        recipientUserIds: r.message.recipientUserIds,
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

  // Omitted/empty/not-an-array means "whole team" (null), same as every
  // message before this existed. When given, every id must itself be
  // able to see this deal — never let a message get privately targeted
  // at someone who couldn't otherwise see this deal at all.
  let recipientUserIds: string[] | null = null;
  const rawRecipients: unknown[] = Array.isArray(body.recipientUserIds) ? body.recipientUserIds : [];
  if (rawRecipients.length > 0) {
    const ids: string[] = rawRecipients.filter((v): v is string => typeof v === "string");
    const deduped: string[] = Array.from(new Set(ids)).filter((uid) => uid !== session.user.id);
    for (const uid of deduped) {
      const targetAuthorized = await authorizeDeal(uid, dealId);
      if (!targetAuthorized) {
        return NextResponse.json({ error: "One of the people you picked can't see this deal" }, { status: 400 });
      }
    }
    if (deduped.length > 0) {
      recipientUserIds = deduped;
    }
  }

  const [message] = await db
    .insert(dealMessages)
    .values({ dealId, userId: session.user.id, content, recipientUserIds })
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
      recipientUserIds: message.recipientUserIds,
    },
  });
}
