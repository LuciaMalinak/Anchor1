import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// Zoom's event notifications for the Anchor Zoom app (Event Subscriptions,
// set up on the app in Zoom Marketplace). Two events matter:
//
// - endpoint.url_validation: Zoom checks this URL is ours before saving it,
//   and again every few days. Answer with the plainToken hashed with the
//   app's secret token.
// - app.deauthorized: someone removed Anchor from their Zoom account. Zoom
//   requires apps to delete that person's data; Anchor only keeps the
//   connection (tokens + Zoom email), so that row is deleted.
//
// Every request is signed: x-zm-signature = "v0=" + HMAC-SHA256(secret,
// "v0:{x-zm-request-timestamp}:{raw body}").

const MAX_AGE_SECONDS = 5 * 60;

function sign(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret) {
    console.error("Zoom webhook: ZOOM_WEBHOOK_SECRET_TOKEN isn't set");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const raw = await req.text();
  const timestamp = req.headers.get("x-zm-request-timestamp") ?? "";
  const signature = req.headers.get("x-zm-signature") ?? "";
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || !Number.isFinite(age) || age > MAX_AGE_SECONDS) {
    return NextResponse.json({ error: "Stale or missing timestamp" }, { status: 401 });
  }
  if (!sameText(signature, `v0=${sign(secret, `v0:${timestamp}:${raw}`)}`)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let body: { event?: string; payload?: Record<string, unknown> };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  if (body.event === "endpoint.url_validation") {
    const plainToken = typeof body.payload?.plainToken === "string" ? body.payload.plainToken : "";
    if (!plainToken) return NextResponse.json({ error: "Missing plainToken" }, { status: 400 });
    return NextResponse.json({ plainToken, encryptedToken: sign(secret, plainToken) });
  }

  if (body.event === "app.deauthorized") {
    const zoomUserId = typeof body.payload?.user_id === "string" ? body.payload.user_id : "";
    if (zoomUserId) {
      const removed = await db
        .delete(integrationConnections)
        .where(
          and(eq(integrationConnections.provider, "zoom"), eq(integrationConnections.externalAccountId, zoomUserId))
        )
        .returning({ id: integrationConnections.id });
      console.log(`Zoom webhook: app removed by a Zoom user, deleted ${removed.length} connection(s)`);
    }
    return NextResponse.json({ ok: true });
  }

  // Other events aren't used; acknowledge so Zoom doesn't retry them.
  return NextResponse.json({ ok: true });
}
