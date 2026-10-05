import { NextResponse } from "next/server";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { adminFillMissingSummaries } from "@/lib/adminMeetingActions";

// App owner only: write real summaries for meetings saved transcript-only
// while Claude was unavailable (see adminMeetingActions.ts).
export async function POST() {
  const admin = await requireAppOwnerApi();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const count = await adminFillMissingSummaries(admin.id);
  return NextResponse.json({ ok: true, count });
}
