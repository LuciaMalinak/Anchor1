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
// Bare `NextResponse.json({error...})` used to be what a click on this
// link showed on anything going wrong — an unstyled raw-JSON page, which
// is a bad thing for anyone (a prospective customer, an investor) to see
// after clicking a "Download" button. Every failure path below now
// returns this same small branded page instead, so a misconfigured or
// empty bucket fails gracefully rather than looking broken.
function unavailablePage(message: string, status: number): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Anchor Desktop</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
  main { max-width: 26rem; padding: 2.5rem 2rem; text-align: center; }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { font-size: 0.9375rem; color: #64748b; margin: 0; line-height: 1.5; }
  a { display: inline-block; margin-top: 1.5rem; font-size: 0.875rem; color: #2563eb; text-decoration: none; }
</style>
</head>
<body>
<main>
  <h1>Anchor Desktop</h1>
  <p>${message}</p>
  <a href="/dashboard/integrations">Back to Anchor</a>
</main>
</body>
</html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isDesktopAppPlatform(platform)) {
    return unavailablePage("That download link isn't valid.", 400);
  }
  if (!isR2Configured()) {
    return unavailablePage("Downloads aren't set up yet — check back shortly.", 503);
  }

  const target = DESKTOP_APP_PLATFORMS[platform];
  const exists = await r2FirstKey(target.key);
  if (!exists) {
    return unavailablePage(
      `The ${platform === "mac" ? "Mac" : "Windows"} build isn't available yet — check back shortly.`,
      404
    );
  }

  // The installer itself is 80-150MB — on anything slower than a fast,
  // uninterrupted connection, downloading it can easily take longer than
  // a couple of minutes, and a paused/resumed browser download re-requests
  // the same URL. A short-lived signed URL (this used to be 120 seconds)
  // means that retry lands after expiry and R2 returns 403 — which is
  // exactly what "the download just fails" looks like from the browser's
  // side. 30 minutes comfortably covers even a slow connection while
  // still not leaving a link usable for long after someone clicks it.
  const url = await r2PresignedGetUrl(target.key, 1800, target.downloadFilename);
  return NextResponse.redirect(url);
}
