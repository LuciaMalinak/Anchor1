// Records the "desktop app" portion of the Anchor demo video.
//
// The real Anchor Desktop app's meeting-detection UI is genuine and safe
// to show, but triggering it for real (a live Zoom call + Recall.ai's
// desktop recording pipeline) hit two live production issues while
// preparing an earlier cut of this video (an HTTP 404 from Recall
// fetching the recording config, then a window-id-mismatch error) —
// real bugs worth fixing, but not something to feature in a product demo.
// Per direction from Lucia (use a fake/staged meeting here, like the
// fake account used for the web walkthrough), this instead drives a
// pixel-faithful static mock of the same renderer UI (same copy, same
// layout, same colors — scripts/demo/desktop-mock.html) through a
// scripted, deterministic state machine — idle, detected, recording (now
// with the real Ask Anchor / live suggestions / to-do panels added to
// the actual Electron app this round — see desktop/src/main.ts,
// anchorApi.ts, preload.ts, and renderer.js/index.html), processing,
// ready — captured as a real screen recording (not a screenshot
// slideshow) so motion (the pulsing record dot, the ticking timer, the
// typed Ask Anchor question, the streamed answer, a task being checked
// off, the activity log appending) reads as fluid and professional.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT_DIR = "/home/claude/anchor-mvp/scripts/demo/out";
const VIDEO_DIR = path.join(OUT_DIR, "desktop-video");
const MOCK_PATH = "file://" + path.join("/home/claude/anchor-mvp/scripts/demo/desktop-mock.html");

fs.mkdirSync(VIDEO_DIR, { recursive: true });

const markers = [];
const t0 = Date.now();
function mark(label) {
  markers.push({ label, atMs: Date.now() - t0 });
  console.log(`[marker] ${(Date.now() - t0) / 1000}s — ${label}`);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  await page.goto(MOCK_PATH, { waitUntil: "load" });
  mark("idle");
  await page.waitForTimeout(3000);
  mark("detected");
  await page.waitForTimeout(4200); // recording starts, panel appears
  mark("suggestions-updated");
  await page.waitForTimeout(4300); // live suggestions land (~7.2s mark)
  mark("ask-anchor-typed");
  await page.waitForTimeout(8000); // question typed + answer streams in, then sits on screen
  mark("task-completed");
  await page.waitForTimeout(3300); // task checked off (~19.5s mark)
  mark("call-ended");
  await page.waitForTimeout(3000); // processing (~22.8s mark)
  mark("summary-ready");
  await page.waitForTimeout(3200); // sit on the ready state (~25.8s mark)
  mark("end");

  await context.close();
  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, "desktop-markers.json"), JSON.stringify(markers, null, 2));
  const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".webm"));
  console.log("video files:", files);
  fs.writeFileSync(path.join(OUT_DIR, "desktop-video-filename.txt"), files[0] || "");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
