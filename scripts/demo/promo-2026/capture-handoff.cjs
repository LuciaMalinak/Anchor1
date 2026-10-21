const { chromium } = require("playwright");
const OUT = process.argv[2], STATE = process.argv[3];
const DEAL = "33f9baf9-f87e-4d25-b396-fdb1084b9f44";
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 2, storageState: STATE });
  await ctx.addInitScript(() => { try { localStorage.setItem("anchor.whatsNew.seen", "2026-10-morning-brief"); } catch {}
    document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important} *{caret-color:transparent}"; document.head.appendChild(s); }); });
  await ctx.route("**/api/meetings/call-feedback", (r) => r.fulfill({ json: { pending: null } }));
  await ctx.route("**/api/morning-brief/pending", (r) => r.fulfill({ json: { pending: null } }));
  await ctx.route(`**/api/deals/${DEAL}/handoff`, async (r) => { await new Promise((x) => setTimeout(x, 300)); r.fulfill({ json: { briefing: {
    whatWasDecided: "Acme is adding 10 EMEA seats next quarter at their current per-seat rate. Sam already promised Priya a formal quote and a straight answer on EU data residency by Thursday — keep both promises exactly as made.",
    whatToPushOn: "Get Priya to say precisely what she needs in writing to sign off. Sam's way: pin the condition down, don't argue it. Keep the start date anchored to next quarter.",
    focusAreas: "Priya decides; Jordan champions. Sam opens with Jordan's adoption numbers (35 of 40 seats active) before money comes up, and answers security questions directly instead of deferring them.",
    personalTouches: "Jordan is quick and informal — first names, short answers. Priya wants specifics in writing; Sam follows every call with Priya by email the same day.",
  } } }); });
  await ctx.route(`**/api/deals/${DEAL}/handoff/notify`, (r) => r.fulfill({ json: { sentTo: "Maya Chen" } }));
  const p = await ctx.newPage();
  await p.goto(`http://localhost:3000/dashboard/deals/${DEAL}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + "/deal-team.png" });
  await p.click('button:has-text("Prepping someone else to run this meeting?")'); await p.waitForTimeout(600);
  const card = p.locator('div:has(> div > p:has-text("Handoff briefing"))').first();
  await card.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90)); await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + "/handoff-open.png" });
  await p.click('button:has-text("Generate handoff briefing")'); await p.waitForTimeout(1500);
  await card.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90)); await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + "/handoff-briefing.png" });
  const send = p.locator('button:has-text("on Slack")');
  console.log("send button:", await send.count() ? await send.innerText() : "missing");
  if (await send.count()) { await send.click(); await p.waitForTimeout(800); }
  await p.screenshot({ path: OUT + "/handoff-sent.png" });
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
