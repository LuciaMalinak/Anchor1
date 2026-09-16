import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { isProviderKey } from "@/lib/integrations/config";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { provider } = await params;
  if (!isProviderKey(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  // This only forgets the token Anchor stored — it doesn't revoke access
  // on the provider's side. Revoking the grant itself (e.g. "Anchor" under
  // Google/Microsoft account permissions) is a separate step for whoever
  // connected it.
  await db
    .delete(integrationConnections)
    .where(
      and(eq(integrationConnections.userId, session.user.id), eq(integrationConnections.provider, provider))
    );

  return NextResponse.json({ ok: true });
}
