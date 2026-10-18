import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runMorningBrief } from "@/lib/morningBrief";

// "Send me one now" on the Profile page: builds today's brief with the
// saved settings and sends it on the chosen channel straight away (even
// if there's nothing urgent), returning the text so the page can show it.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const result = await runMorningBrief(session.user.id, { sendWhenEmpty: true });
  if (result.status === "failed") {
    return NextResponse.json({ error: "Couldn't put your brief together. Try again in a minute." }, { status: 502 });
  }
  const found = {
    googleConnected: result.snapshot.googleConnected,
    emails: result.snapshot.emails.length,
    replies: result.snapshot.emails.filter((e) => e.reply).length,
    drafts: result.snapshot.emails.filter((e) => e.drafted).length,
    problems: result.problems,
  };
  if (result.status === "empty") return NextResponse.json({ sent: false, text: null, ...found });
  return NextResponse.json({
    sent: result.delivery.sent,
    channel: result.delivery.channel,
    note: result.delivery.note ?? null,
    text: result.text,
    ...found,
  });
}

export const maxDuration = 120;
