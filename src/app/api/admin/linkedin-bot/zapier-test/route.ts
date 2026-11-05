import { NextResponse } from "next/server";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { sendZapierSample } from "@/lib/linkedinBot/run";

// "Send a sample to Zapier": lets the Zap see the fields while it's being
// set up.
export async function POST() {
  if (!(await requireAppOwnerApi())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await sendZapierSample();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
