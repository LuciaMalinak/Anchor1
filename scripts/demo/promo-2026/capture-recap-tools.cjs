const { chromium } = require("playwright");
const fs = require("fs");
const OUT = process.argv[2], STATE = process.argv[3], TEXT = fs.readFileSync(process.argv[4], "utf8");
const MEET = "a39b716a-add6-449e-8e0b-92bfdf9ca0ca";
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 2, storageState: STATE });
  await ctx.addInitScript(() => { try { localStorage.setItem("anchor.whatsNew.seen", "2026-10-morning-brief"); } catch {}
    document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important} *{caret-color:transparent} [class*='fixed'][class*='bottom']{display:none!important}"; document.head.appendChild(s); }); });
  await ctx.route("**/api/meetings/call-feedback", (r) => r.fulfill({ json: { pending: null } }));
  await ctx.route("**/api/morning-brief/pending", (r) => r.fulfill({ json: { pending: null } }));
  await ctx.route(`**/api/meetings/${MEET}/crm-update`, (r) => r.fulfill({ json: {
    snapshot: { provider: "salesforce", recordName: "Acme Robotics — EMEA Expansion", recordUrl: null, stage: "Qualification", stageOptions: [{ value: "Qualification", label: "Qualification" }, { value: "Proposal/Price Quote", label: "Proposal/Price Quote" }], closeDate: "2026-12-31", amount: 50000, nextStep: "Discovery" },
    proposal: { stage: { value: "Proposal/Price Quote", reason: "A formal quote was promised today." }, closeDate: { value: "2026-11-28", reason: "Jordan wants the EMEA team live next quarter." }, amount: { value: 62000, reason: "10 seats at the existing $6,200 per-seat rate." }, nextStep: { value: "Send quote; EU residency answer by Thu", reason: "Both promised on the call." } } } }));
  await ctx.route(`**/api/meetings/${MEET}/slack-post`, (r) => {
    const body = JSON.parse(r.request().postData());
    if (body.action === "prepare") return r.fulfill({ json: { channels: [{ id: "C1", name: "acme-robotics" }, { id: "C2", name: "deals" }], text: TEXT } });
    return r.fulfill({ json: { posted: true, permalink: "https://slack.com/archives/C1/p1" } });
  });
  await ctx.route(`**/api/meetings/${MEET}/dropbox-save`, (r) => r.fulfill({ json: { path: "/Anchor/Acme Robotics — Platform Rollout/2026-10-18 Acme Robotics — EMEA Expansion Discussion.md", link: "https://www.dropbox.com/home/Anchor" } }));
  const p = await ctx.newPage();
  await p.goto(`http://localhost:3000/dashboard/meetings/${MEET}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + "/r-top.png" });
  const toEl = async (sel) => { await p.locator(sel).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90)); await p.waitForTimeout(700); };
  await p.click('button:has-text("Suggest updates")'); await p.waitForTimeout(1200);
  await toEl('section:has(h2:has-text("Update Salesforce"))'); await p.screenshot({ path: OUT + "/r-crm.png" });
  await p.click('button:has-text("Draft a Slack post")'); await p.waitForTimeout(1200);
  const slack = p.locator('section:has(h2:has-text("Post to Slack"))');
  await slack.locator("select").selectOption("C1");
  await slack.locator('button:has-text("Post")').click(); await p.waitForTimeout(800);
  await p.click('button:has-text("Save to Dropbox")'); await p.waitForTimeout(800);
  await toEl('section:has(h2:has-text("Post to Slack"))'); await p.screenshot({ path: OUT + "/r-slack.png" });
  await toEl('section:has(h2:has-text("Save to Dropbox"))'); await p.screenshot({ path: OUT + "/r-dropbox.png" });
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
