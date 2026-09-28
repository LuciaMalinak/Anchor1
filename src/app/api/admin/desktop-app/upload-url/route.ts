import { NextRequest, NextResponse } from "next/server";
import { getDesktopAppUploadSecret } from "@/lib/desktopAppUploadSecret";
import { r2PresignedPutUrl, isR2Configured } from "@/lib/r2";
import { DESKTOP_APP_PLATFORMS, isDesktopAppPlatform } from "@/lib/desktopAppPlatforms";

// Issues a short-lived, direct-to-R2 upload URL for a new Anchor Desktop
// build — the actual installer bytes go straight from whoever calls this
// (Lucia's own machine, via curl) to R2, never through this server, so a
// ~150-400MB Electron build never gets buffered in Render's memory. See
// src/lib/desktopAppUploadSecret.ts for why this requires a real secret
// with no fallback, and src/app/api/download/desktop-app/[platform]/route.ts
// for the matching public download side.
export async function POST(req: NextRequest) {
  const secret = getDesktopAppUploadSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "DESKTOP_APP_UPLOAD_SECRET isn't set in this environment — uploads are disabled." },
      { status: 503 }
    );
  }
  if (req.headers.get("x-upload-secret") !== secret) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (!isR2Configured()) {
    return NextResponse.json({ error: "R2 storage isn't configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const platform = body.platform;
  if (typeof platform !== "string" || !isDesktopAppPlatform(platform)) {
    return NextResponse.json({ error: 'platform must be "mac" or "win"' }, { status: 400 });
  }
  const target = DESKTOP_APP_PLATFORMS[platform];

  const uploadUrl = await r2PresignedPutUrl(target.key, target.contentType, 600);
  return NextResponse.json({ uploadUrl, key: target.key, expiresInSeconds: 600 });
}
