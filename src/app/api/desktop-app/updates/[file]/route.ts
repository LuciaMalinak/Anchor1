import { NextRequest, NextResponse } from "next/server";
import { r2Get, r2PresignedGetUrl, isR2Configured } from "@/lib/r2";
import { DESKTOP_APP_PLATFORMS } from "@/lib/desktopAppPlatforms";

// The feed electron-updater polls from inside the desktop app (see
// desktop/src/main.ts's initAutoUpdate, and desktop/package.json's
// "publish" config, which is what bakes this URL into the packaged
// app as app-update.yml). Public, unauthenticated, GET-only — same
// posture as /api/download/desktop-app/[platform], just structured the
// way electron-updater's "generic" provider expects: it always asks
// for exactly "latest-mac.yml" or "latest.yml" first (small YAML files
// naming the current version + installer filename + sha512, generated
// automatically by electron-builder at package time — never handwritten
// or uploaded manually except as a copy-the-build-output step), then
// requests whatever installer filename that YAML named, from this same
// base URL.
//
// The two YAML files are served as their actual text (small, so
// proxying them through this server is fine — unlike the installers
// below, which stay off this server's memory the same way the ordinary
// download route does: redirect to a freshly presigned R2 URL).
const YML_KEYS: Record<string, string> = {
  "latest-mac.yml": "desktop-app/mac/latest-mac.yml",
  "latest.yml": "desktop-app/win/latest.yml",
};

const INSTALLER_KEYS: Record<string, string> = {
  "Anchor-Desktop-mac.zip": DESKTOP_APP_PLATFORMS.mac.key,
  "Anchor-Desktop-Setup.exe": DESKTOP_APP_PLATFORMS.win.key,
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;

  if (!isR2Configured()) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const ymlKey = YML_KEYS[file];
  if (ymlKey) {
    const buf = await r2Get(ymlKey);
    if (!buf) {
      // No update published yet for this platform — electron-updater
      // treats a 404 here as "no update available" and just tries
      // again on its next scheduled check, not an error worth logging
      // loudly on the client side (see initAutoUpdate's error handler).
      return NextResponse.json({ error: "No update feed published yet" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "text/yaml; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  const installerKey = INSTALLER_KEYS[file];
  if (installerKey) {
    // Same reasoning as the public download route: this is an 80-150MB
    // file, so give electron-updater's own download plenty of headroom
    // rather than the 120 seconds this used to be.
    const url = await r2PresignedGetUrl(installerKey, 1800);
    return NextResponse.redirect(url);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
