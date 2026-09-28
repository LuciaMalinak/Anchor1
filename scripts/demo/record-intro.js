// Records the new, more cinematic video intro — a big logo pop-in
// followed by a staggered wordmark reveal and a team-agnostic tagline
// (Lucia's round-2 feedback: "a better intro into the video like a big
// logo pops up and so on"). Same approach as the desktop-mock capture:
// a pixel-precise static HTML/CSS mock (scripts/demo/intro-mock.html)
// driven entirely by CSS animations/keyframes, screen-recorded with
// Playwright so the motion (the logo's spring-in, the sonar-ping ring,
// the staggered per-letter wordmark, the fading-in tagline) is real,
// smooth video rather than a slideshow of static cards.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT_DIR = "/home/claude/anchor-mvp/scripts/demo/out";
const VIDEO_DIR = path.join(OUT_DIR, "intro-video");
const MOCK_PATH = "file://" + path.join("/home/claude/anchor-mvp/scripts/demo/intro-mock.html");

fs.mkdirSync(VIDEO_DIR, { recursive: true });

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
  // Full animation timeline (see intro-mock.html): glow @0.1s, ring ping
  // @0.55-2.15s, logo pop @0.5-1.35s, wordmark letters @1.35-1.65s,
  // tagline line 1 @2.05-2.75s, tagline line 2 @2.85-3.55s. Hold on the
  // finished card for a beat before cutting to the web walkthrough.
  await page.waitForTimeout(6200);

  await context.close();
  await browser.close();

  const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".webm"));
  console.log("video files:", files);
  fs.writeFileSync(path.join(OUT_DIR, "intro-video-filename.txt"), files[0] || "");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
