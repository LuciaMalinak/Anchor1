import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { authorizeDeal } from "@/lib/dealAccess";
import { authenticateBearer } from "@/lib/apiToken";
import { createSdkUpload } from "@/lib/recall";

// The desktop app's equivalent of /api/meetings/mic/start and
// /api/meetings/join — called the moment Anchor's desktop app detects a
// Zoom/Teams/Meet window and the person chooses to record it, no bot
// ever joining the call (see desktop/ at the repo root and
// src/lib/apiToken.ts for why this uses a bearer token instead of a
// session cookie). Creates the meeting row live (status "recording", same
// as the in-person mic flow) and asks Recall.ai for a Desktop SDK upload
// slot, so the desktop app has an uploadToken to hand to
// RecallAiSdk.startRecording() right away.
export async function POST(req: NextRequest) {
  const userId = await authenticateBearer(req);
  if (!userId) {
    return NextResponse.json({ error: "Invalid or missing desktop token" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dealId = typeof body.dealId === "string" && body.dealId ? body.dealId : null;
  const title =
    typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Desktop recording";

  if (dealId && !(await authorizeDeal(userId, dealId))) {
    return NextResponse.json({ error: "That deal wasn't found" }, { status: 400 });
  }

  // Same one-live-capture-per-deal guard as the bot-join and in-person
  // mic flows, for the same reason.
  const [existing] = await db
    .select({ id: meetings.id, dealId: meetings.dealId })
    .from(meetings)
    .where(
      and(
        eq(meetings.userId, userId),
        dealId ? eq(meetings.dealId, dealId) : isNull(meetings.dealId),
        inArray(meetings.status, ["joining", "recording"])
      )
    )
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: "Anchor's already in a live meeting here.", meeting: existing },
      { status: 409 }
    );
  }

  let uploadToken: string;
  let recordingId: string;
  try {
    ({ uploadToken, recordingId } = await createSdkUpload());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't start a desktop recording with Recall.ai" },
      { status: 502 }
    );
  }

  const [meeting] = await db
    .insert(meetings)
    .values({
      userId,
      title,
      status: "recording",
      dealId,
      recallRecordingId: recordingId,
    })
    .returning();

  return NextResponse.json({ meeting, uploadToken }, { status: 201 });
}
