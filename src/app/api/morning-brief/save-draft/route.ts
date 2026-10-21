import { NextResponse } from "next/server";
import { NeedsGooglePermissionError } from "@/lib/integrations/google";
import { createGmailDraft } from "@/lib/integrations/gmailDraft";
import { replyDraft } from "@/lib/integrations/gmailMime";
import { briefActor, loadBriefEmail, saveBriefEmail, validThreadId } from "@/lib/briefActions";

// "Save to Gmail drafts" on one email in the Morning brief: puts the
// suggested reply in Gmail, in the right thread, ready to review and send.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const userId = await briefActor(body.token);
  if (!userId) return NextResponse.json({ error: "This link has expired. Open today's brief instead." }, { status: 401 });
  const threadId = validThreadId(body.threadId);
  if (!threadId) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  const { brief, email, shown } = await loadBriefEmail(userId, threadId);
  if (!brief || !email?.reply) return NextResponse.json({ error: "That reply isn't in your latest brief." }, { status: 404 });
  try {
    const result = await createGmailDraft(userId, replyDraft(email, email.reply), { threadId });
    await saveBriefEmail(userId, brief, shown, threadId, { email: { drafted: true }, shown: { drafted: true } });
    return NextResponse.json({ ok: true, openUrl: result.openUrl });
  } catch (err) {
    if (err instanceof NeedsGooglePermissionError) {
      const returnTo = typeof body.token === "string" ? `/brief/${body.token}?item=${threadId}` : "/dashboard";
      return NextResponse.json(
        {
          error: "needs_google_permission",
          connectUrl: `/api/integrations/google/connect?add=${err.scopeKey}&returnTo=${encodeURIComponent(returnTo)}`,
        },
        { status: 403 }
      );
    }
    console.error("[morning-brief save-draft]", err);
    return NextResponse.json({ error: "Couldn't save it to Gmail. Try again." }, { status: 502 });
  }
}
