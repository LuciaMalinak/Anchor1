import { NextResponse } from "next/server";
import { NeedsGooglePermissionError } from "@/lib/integrations/google";
import { createGmailDraft } from "@/lib/integrations/gmailDraft";
import { replyDraft } from "@/lib/integrations/gmailMime";
import { fetchReplyAll } from "@/lib/integrations/gmailInbox";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
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
    // Recipients and threading from the thread as it is now, so the draft
    // replies to everyone on it even for a brief saved before that was
    // recorded, or with people added since.
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    const live = await fetchReplyAll(userId, threadId, user ? [user.email] : []).catch((err) => {
      console.error("[morning-brief save-draft] reading the thread failed:", err);
      return null;
    });
    const target = live ? { ...email, replyAll: live.replyAll, replyToHeader: live.messageIdHeader ?? email.replyToHeader } : email;
    const result = await createGmailDraft(userId, replyDraft(target, email.reply), { threadId });
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
