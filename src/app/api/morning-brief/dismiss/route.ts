import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readBriefToken } from "@/lib/briefLink";
import { dismissBriefItem } from "@/lib/morningBrief";

// "Done" / "Snooze 3 days" on an email in the Morning brief. Works from
// the brief's own link (token) without signing in, or signed in.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const session = await auth();
  const fromToken = typeof body.token === "string" ? readBriefToken(body.token) : null;
  const userId = fromToken?.userId ?? session?.user?.id;
  if (!userId) return NextResponse.json({ error: "This link has expired. Open today's brief instead." }, { status: 401 });
  const threadId = typeof body.threadId === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(body.threadId) ? body.threadId : null;
  const action = body.action === "done" ? "done" : body.action === "snooze" ? "snooze" : null;
  if (!threadId || !action) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  const until = await dismissBriefItem(userId, threadId, action);
  return NextResponse.json({ ok: true, until });
}
