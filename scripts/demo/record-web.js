// Records the "website" portion of the Anchor demo video by driving a
// real headless Chromium through the local dev server (localhost:3000)
// with a fresh, fully fictional demo account — never touches production
// or any real customer's data. The seeded account has a full multi-quarter
// history (one flagship account across four meetings over ~7 months, plus
// two newer pipeline deals) so the walkthrough shows what Anchor looks
// like after real, sustained use rather than a single just-created deal.
// Writes a raw .webm (Playwright's built-in video recording) plus a JSON
// file of {label, atMs} markers so a later ffmpeg pass can drop matching
// on-screen captions at the right times.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "http://localhost:3000";
const OUT_DIR = "/home/claude/anchor-mvp/scripts/demo/out";
const VIDEO_DIR = path.join(OUT_DIR, "web-video");
const DEMO_EMAIL = "sam.rivera@example.com";
const DEMO_PASSWORD = "DemoPass123!";

fs.mkdirSync(VIDEO_DIR, { recursive: true });

const markers = [];
const t0 = Date.now();
function mark(label) {
  markers.push({ label, atMs: Date.now() - t0 });
  console.log(`[marker] ${(Date.now() - t0) / 1000}s — ${label}`);
}

async function smoothScroll(page, deltaY, steps = 16, pause = 45) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, deltaY / steps);
    await page.waitForTimeout(pause);
  }
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

  // 1. Landing page — brief, just enough to establish context.
  await page.goto(`${BASE_URL}/`, { waitUntil: "load" });
  mark("landing");
  await page.waitForTimeout(1000);
  await smoothScroll(page, 420);
  await page.waitForTimeout(700);
  await smoothScroll(page, -420);
  await page.waitForTimeout(400);

  // 2. Sign up
  await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "load" });
  mark("sign-up");
  await page.waitForTimeout(500);
  await page.fill('input[name="name"]', "Sam Rivera");
  await page.waitForTimeout(200);
  await page.fill('input[name="email"]', DEMO_EMAIL);
  await page.waitForTimeout(200);
  await page.fill('input[name="password"]', DEMO_PASSWORD);
  await page.waitForTimeout(150);
  await page.fill('input[name="confirmPassword"]', DEMO_PASSWORD);
  await page.waitForTimeout(400);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1200);
  mark("signed-up");

  // Seed the rich multi-quarter demo history now that the account exists.
  const seedRes = await page.evaluate(async (email) => {
    const r = await fetch(`/api/admin/seed-demo?key=local-demo-only&email=${encodeURIComponent(email)}`);
    return r.json();
  }, DEMO_EMAIL);
  console.log("seed result:", seedRes);
  if (!seedRes.ok) throw new Error("seed failed: " + JSON.stringify(seedRes));

  // 3. Dashboard home — a full to-do list and an activity feed spanning
  // three accounts and seven months, not a blank just-signed-up state.
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
  mark("dashboard-home");
  await page.waitForTimeout(1600);
  await smoothScroll(page, 500);
  await page.waitForTimeout(2200);
  await smoothScroll(page, 500);
  await page.waitForTimeout(2200);

  // 4. Deals list — three accounts at different stages, not one.
  await page.goto(`${BASE_URL}/dashboard/deals`, { waitUntil: "load" });
  mark("deals-list");
  await page.waitForTimeout(2800);

  // 5. Into the flagship account
  await page.click('a:has-text("Acme Robotics — Platform Rollout")');
  await page.waitForLoadState("load");
  mark("deal-detail");
  await page.waitForTimeout(1800);
  await smoothScroll(page, 450);
  await page.waitForTimeout(2200);

  // 6. AFTER tab — the full meeting history, newest first: expansion
  // conversation, quarterly review, security/pricing follow-up, kickoff.
  await page.click('button:has-text("AFTER")');
  await page.waitForTimeout(1200);
  mark("after-tab-history");
  await smoothScroll(page, 480);
  await page.waitForTimeout(2000);
  await smoothScroll(page, 480);
  await page.waitForTimeout(2000);
  await smoothScroll(page, 480);
  await page.waitForTimeout(2000);

  // 7. Into the newest meeting's own page — shows the continuity note
  // tying it back to the quarterly review before it.
  const transcriptLink = page.locator('a:has-text("Full transcript")').first();
  if (await transcriptLink.count()) {
    await transcriptLink.click();
    await page.waitForLoadState("load");
    mark("meeting-detail");
    await page.waitForTimeout(2200);
    await smoothScroll(page, 500);
    await page.waitForTimeout(2400);
    await smoothScroll(page, 700);
    await page.waitForTimeout(2200);
    await page.goBack({ waitUntil: "load" }).catch(() => {});
  }

  // 8. Back on the deal — Ask Anchor, grounded in the ENTIRE history.
  //
  // The real /api/deals/[id]/assist route calls the Anthropic API, and
  // the shared dev API key in .env.local has run out of credit — a real
  // call here would just render the "Thinking…" spinner forever. Rather
  // than skip this feature (it's one of the best "wow" moments) or show
  // a broken state, the response is mocked with a canned answer that's
  // grounded in the exact same seeded meeting/summary content a real
  // call would have used — same route, same streaming content type,
  // just a stand-in for a model call this key can't make right now.
  await page.route("**/api/deals/*/assist", async (route) => {
    await new Promise((r) => setTimeout(r, 1400));
    const answer =
      "Night and day. The kickoff call was about proving the basics — SOC 2 review, seat pricing, getting Priya comfortable. Once that cleared, adoption took off: 35 of the 40 team members are active today. Now the conversation has shifted entirely to growth — a 10-seat EMEA expansion and a Slack integration request — with one open thread: Priya needs a real answer on EU data residency before she signs off.";
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: answer,
    });
  });
  await page.click('button:has-text("BEFORE")').catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  mark("ask-anchor-open");
  const askInput = page.locator('input[placeholder*="push back"]');
  if (await askInput.count()) {
    await askInput.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await askInput.click();
    await askInput.type("How has this account evolved since our first call with them?", { delay: 28 });
    await page.waitForTimeout(400);
    mark("ask-anchor-submit");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3200); // canned "thinking" delay + answer render
    // AskAnchorPanel's own auto-scroll-to-latest-message (bottomRef.
    // scrollIntoView) can drag the WHOLE page down once the answer
    // renders, not just its own little scrollable turns list — pull the
    // page back so the question + answer are actually in frame for the
    // time it sits on screen.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await askInput.scrollIntoViewIfNeeded();
    mark("ask-anchor-answered");
    await page.waitForTimeout(4200); // let it sit on screen, readable
  }
  await page.waitForTimeout(1000);

  // 9. Contacts — a relationship that's visibly grown over time, not a
  // single freshly-created contact.
  await page.goto(`${BASE_URL}/dashboard/contacts`, { waitUntil: "load" });
  mark("contacts");
  await page.waitForTimeout(2800);

  // 10. Back home for the outro beat.
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
  mark("dashboard-outro");
  await page.waitForTimeout(2400);

  mark("end");
  await context.close();
  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, "web-markers.json"), JSON.stringify(markers, null, 2));

  // Playwright names the video file itself; find it and give it a stable name.
  const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".webm"));
  console.log("video files:", files);
  fs.writeFileSync(path.join(OUT_DIR, "web-video-filename.txt"), files[0] || "");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
