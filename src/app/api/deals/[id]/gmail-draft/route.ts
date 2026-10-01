import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { authorizeDeal } from "@/lib/dealAccess";
import { isProviderConfigured } from "@/lib/integrations/config";
import { NeedsGooglePermissionError } from "@/lib/integrations/google";
import { createGmailDraft } from "@/lib/integrations/gmailDraft";
import { safeReturnTo } from "@/lib/integrations/returnTo";

const Body = z.object({
  to: z.array(z.string().email()).max(20),
  subject: z.string().min(1).max(250),
  body: z.string().min(1).max(20_000),
  returnTo: z.string().max(300).optional(),
});

// Saves a deal email (e.g. a nudge) to the user's Gmail drafts. Same as
// the meeting follow-up route, scoped to a deal. Never sends anything.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await authorizeDeal(session.user.id, id))) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (!isProviderConfigured("google")) {
    return NextResponse.json({ error: "Google isn't set up on this server yet." }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the email has a subject, a body and valid addresses." }, { status: 400 });
  }
  const { returnTo, ...draft } = parsed.data;

  try {
    return NextResponse.json(await createGmailDraft(session.user.id, draft));
  } catch (err) {
    if (err instanceof NeedsGooglePermissionError) {
      const back = safeReturnTo(returnTo ?? null) ?? `/dashboard/deals/${id}`;
      return NextResponse.json(
        {
          error: "needs_google_permission",
          connectUrl: `/api/integrations/google/connect?add=${err.scopeKey}&returnTo=${encodeURIComponent(back)}`,
        },
        { status: 403 }
      );
    }
    console.error("[deal gmail-draft]", err);
    return NextResponse.json({ error: "Couldn't save to Gmail. Try again." }, { status: 502 });
  }
}
