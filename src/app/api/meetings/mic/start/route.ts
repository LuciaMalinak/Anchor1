import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { authorizeDeal } from "@/lib/dealAccess";

// Starts an in-person ("Record in person") meeting's row the moment
// recording actually begins, with status "recording" from the start —
// rather than only creating it once you stop and upload, the way this
// used to work. This is what lets an in-person meeting show up in the
// During tab's live panel and pop the Focus window open with a real-time
// transcript + coaching, the same way a Zoom/Teams call Anchor's bot
// joins already does (see /api/meetings/join) — none of that code cares
// where a live meeting's segments come from, only that the row exists
// and is "recording". The actual audio only gets attached once recording
// stops — see /api/meetings/[id]/finish-recording. See
// src/components/MicRecorder.tsx for the client side of this.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dealId = typeof body.dealId === "string" && body.dealId ? body.dealId : null;
  const title =
    typeof body.title === "string" && body.title.trim() ? body.title.trim() : "In-person recording";

  if (dealId && !(await authorizeDeal(session.user.id, dealId))) {
    return NextResponse.json({ error: "That deal wasn't found" }, { status: 400 });
  }

  // Same guard as /api/meetings/join, and for the same reason: one live
  // capture — bot-joined OR in-person — at a time per deal, so starting
  // an in-person recording while a Zoom bot is already live for the same
  // deal (or double-clicking "Start recording") doesn't create two
  // overlapping live meetings for what's really one call.
  const [existing] = await db
    .select({ id: meetings.id, dealId: meetings.dealId })
    .from(meetings)
    .where(
      and(
        eq(meetings.userId, session.user.id),
        dealId ? eq(meetings.dealId, dealId) : isNull(meetings.dealId),
        inArray(meetings.status, ["joining", "recording"])
      )
    )
    .limit(1);
  if (existing) {
    return NextResponse.json(
      {
        error: "Anchor's already in a live meeting here — check the During tab.",
        meeting: existing,
      },
      { status: 409 }
    );
  }

  const [meeting] = await db
    .insert(meetings)
    .values({
      userId: session.user.id,
      title,
      status: "recording",
      dealId,
    })
    .returning();

  return NextResponse.json({ meeting }, { status: 201 });
}
