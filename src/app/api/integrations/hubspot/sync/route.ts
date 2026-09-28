import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncHubspotData } from "@/lib/integrations/hubspot";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const result = await syncHubspotData(session.user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("HubSpot sync failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
