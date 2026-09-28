import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { generateToken } from "@/lib/apiToken";

// Manages the desktop app's bearer tokens from the Integrations page —
// see src/lib/apiToken.ts for what these are and why. One user can have
// more than one (e.g. a work laptop and a home laptop), each separately
// revocable.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: apiTokens.id,
      label: apiTokens.label,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, session.user.id));

  return NextResponse.json({ tokens: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "Desktop app";

  const { token, hash } = generateToken();
  const [row] = await db
    .insert(apiTokens)
    .values({
      userId: session.user.id,
      tokenHash: hash,
      label,
    })
    .returning({ id: apiTokens.id, label: apiTokens.label, createdAt: apiTokens.createdAt });

  // The only time the plaintext token is ever sent anywhere — the
  // caller (Integrations page) is expected to show it to the user once
  // and tell them to paste it into the desktop app now, since Anchor
  // itself can't show it again after this response.
  return NextResponse.json({ token, tokenInfo: row }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing token id" }, { status: 400 });
  }

  await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, session.user.id)));

  return NextResponse.json({ ok: true });
}
