import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorizeDeal } from "@/lib/dealAccess";
import { sendSlackDirectMessage, SlackRecipientNotFoundError } from "@/lib/integrations/slack";

// Sends an already-generated handoff briefing straight to the deal's
// designated backup as a Slack DM — the point of a handoff is that they
// see it BEFORE the meeting, not that whoever's leaving finds them in the
// hallway. Takes the briefing text from the client rather than
// regenerating it here, since it's the same one already on screen (and
// regenerating would risk sending a subtly different version than what
// was reviewed). Uses the CURRENT user's own Slack connection to send —
// Slack has no notion of sending "as" the recipient, only "to" them.
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
  const { deal } = authorized;

  if (!deal.backupUserId) {
    return NextResponse.json(
      { error: "This deal doesn't have a backup set yet — set one on the Team panel first." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "Nothing to send — generate a briefing first." }, { status: 400 });
  }

  const [backup] = await db.select().from(users).where(eq(users.id, deal.backupUserId));
  if (!backup) {
    return NextResponse.json({ error: "That backup teammate no longer exists." }, { status: 400 });
  }

  try {
    await sendSlackDirectMessage(session.user.id, { toEmail: backup.email, text: body.text });
    return NextResponse.json({ ok: true, sentTo: backup.name || backup.email });
  } catch (err) {
    if (err instanceof SlackRecipientNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't send that to Slack." },
      { status: 502 }
    );
  }
}
