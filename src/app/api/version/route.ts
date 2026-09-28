import { NextResponse } from "next/server";
import { getAppVersion } from "@/lib/appVersion";

// Polled by components/UpdateBanner.tsx to notice when a newer deploy has
// gone live while someone still has an old tab open. Deliberately tiny,
// public, and uncached — the whole point is that it must NOT be served
// from a CDN/browser cache, or a stale tab would just keep polling a
// stale answer forever.
export async function GET() {
  return NextResponse.json(
    { version: getAppVersion() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
