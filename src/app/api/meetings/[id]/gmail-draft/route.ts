import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { authorizeMeeting } from "@/lib/meetingAccess";
import { isProviderConfigured } from "@/lib/integrations/config";
import { NeedsGooglePermissionError } from "@/lib/integrations/google";
import { createGmailDraft } from "@/lib/integrations/gmailDraft";

const Body = z.object({
  to: z.array(z.string().email()).max(20),
  subject: z.string().min(1).max(250),
  body: z.string().min(1).max(20_000),
});

// Saves the follow-up email (as edited in FollowUpEmailDraft) to the
// user's Gmail drafts. Never sends anything.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await authorizeMeeting(session.user.id, id))) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  if (!isProviderConfigured("google")) {
    return NextResponse.json({ error: "Google isn't set up on this server yet." }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the email has a subject, a body and valid addresses." }, { status: 400 });
  }

  try {
    return NextResponse.json(await createGmailDraft(session.user.id, parsed.data));
  } catch (err) {
    if (err instanceof NeedsGooglePermissionError) {
      return NextResponse.json(
        {
          error: "needs_google_permission",
          connectUrl: `/api/integrations/google/connect?add=${err.scopeKey}&returnTo=${encodeURIComponent(`/dashboard/meetings/${id}`)}`,
        },
        { status: 403 }
      );
    }
    console.error("[gmail-draft]", err);
    return NextResponse.json({ error: "Couldn't save to Gmail. Try again." }, { status: 502 });
  }
}
