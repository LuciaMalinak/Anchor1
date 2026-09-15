import { chromium } from "playwright";

const COOKIE = process.env.SCREENSHOT_COOKIE;
const MEETING_ID = process.env.SCREENSHOT_MEETING_ID;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addCookies([
  {
    name: "authjs.session-token",
    value: COOKIE,
    domain: "localhost",
    path: "/",
    httpOnly: true,
  },
]);

const page = await context.newPage();

await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
await page.screenshot({ path: "/home/claude/anchor-mvp/screenshots/dashboard.png", fullPage: true });

await page.goto(`http://localhost:3000/dashboard/meetings/${MEETING_ID}`, { waitUntil: "networkidle" });
await page.screenshot({ path: "/home/claude/anchor-mvp/screenshots/meeting-detail.png", fullPage: true });

await browser.close();
console.log("done");
