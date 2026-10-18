import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { autoDraftReplies } from "@/lib/morningBrief";

// "Draft my replies now": puts a reply in Gmail drafts for every email
// waiting on this person, straight away, and says exactly what it did —
// which Google account, what it drafted, what it skipped and why.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    return NextResponse.json(await autoDraftReplies(session.user.id, { everything: true }));
  } catch (err) {
    console.error("[draft-now]", err);
    return NextResponse.json({ error: `Couldn't draft replies: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}

export const maxDuration = 180;
