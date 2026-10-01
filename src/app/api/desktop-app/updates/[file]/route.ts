import { NextRequest, NextResponse } from "next/server";
import { r2Get, r2GetStream, isR2Configured } from "@/lib/r2";
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
// The two YAML files are served as their actual text (small). The
// installers are streamed through from R2 rather than redirected to it —
// see the comment on the installer branch below for why.
const YML_KEYS: Record<string, string> = {
  "latest-mac.yml": "desktop-app/mac/latest-mac.yml",
  "latest.yml": "desktop-app/win/latest.yml",
};

const INSTALLER_KEYS: Record<string, string> = {
  "Anchor-Desktop-mac.zip": DESKTOP_APP_PLATFORMS.mac.key,
  "Anchor-Desktop-Setup.exe": DESKTOP_APP_PLATFORMS.win.key,
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
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
    // Streamed through this server on Anchor's own domain, not redirected
    // to a presigned R2 URL like the browser download is. Installed apps
    // already reach this domain for everything else, whereas the R2
    // hostname (<bucket>.<account>.r2.cloudflarestorage.com) fails to
    // resolve on some networks (company DNS filters and the like), which
    // showed up as net::ERR_NAME_NOT_RESOLVED and blocked every update.
    // Streaming keeps the 80-150MB file out of this server's memory; Range
    // requests pass through so an interrupted download can resume.
    const object = await r2GetStream(installerKey, req.headers.get("range"));
    if (!object) {
      return NextResponse.json({ error: "No installer published yet" }, { status: 404 });
    }
    const headers: Record<string, string> = {
      "Content-Type": object.contentType || "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    };
    if (object.contentLength !== null) headers["Content-Length"] = String(object.contentLength);
    if (object.contentRange) headers["Content-Range"] = object.contentRange;
    return new Response(object.body, { status: object.partial ? 206 : 200, headers });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
