import { NextRequest, NextResponse } from "next/server";
import { r2PresignedGetUrl, r2FirstKey, isR2Configured } from "@/lib/r2";
import { DESKTOP_APP_PLATFORMS, isDesktopAppPlatform } from "@/lib/desktopAppPlatforms";

// Public, unauthenticated — this is the link the sign-in banner
// (DesktopAppAnnouncement.tsx) and any "download Anchor Desktop" button
// point to. Re-signs a fresh short-lived R2 URL and redirects to it on
// every click rather than serving a long-lived link, so the bytes always
// go straight from R2 to the browser (never buffered by this server) and
// the public link itself never expires even though each signed URL does.
// See src/app/api/admin/desktop-app/upload-url/route.ts for how a build
// gets uploaded in the first place.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isDesktopAppPlatform(platform)) {
    return NextResponse.json({ error: 'platform must be "mac" or "win"' }, { status: 400 });
  }
  if (!isR2Configured()) {
    return NextResponse.json({ error: "Downloads aren't configured yet" }, { status: 503 });
  }

  const target = DESKTOP_APP_PLATFORMS[platform];
  const exists = await r2FirstKey(target.key);
  if (!exists) {
    return NextResponse.json(
      { error: `No ${platform === "mac" ? "Mac" : "Windows"} build has been uploaded yet` },
      { status: 404 }
    );
  }

  const url = await r2PresignedGetUrl(target.key, 120, target.downloadFilename);
  return NextResponse.redirect(url);
}
