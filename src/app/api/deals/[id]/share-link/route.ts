import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { authorizeDeal } from "@/lib/dealAccess";
import { createShareToken } from "@/lib/shareLink";

function baseUrl(req: NextRequest): string {
  return process.env.AUTH_URL || req.nextUrl.origin;
}

// A link to this deal's customer-facing next-steps page, valid 30 days.
// Anyone on the deal can make one; the page shows only the agreed action
// items and scheduled calls, never internal notes or signals.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await authorizeDeal(session.user.id, id))) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const { token, expiresAt } = createShareToken(id);
  return NextResponse.json({ url: `${baseUrl(req)}/share/${token}`, expiresAt: expiresAt.toISOString() });
}
