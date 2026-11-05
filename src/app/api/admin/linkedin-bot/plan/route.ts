import { NextResponse } from "next/server";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { planDay } from "@/lib/linkedinBot/run";

// "Write today's posts again": replaces today's not-yet-posted drafts.
export async function POST() {
  if (!(await requireAppOwnerApi())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, ...(await planDay({ replace: true })) });
  } catch (err) {
    console.error("[linkedinBot] planning failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export const maxDuration = 300;
