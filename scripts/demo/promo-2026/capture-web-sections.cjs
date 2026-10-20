const { chromium } = require("playwright");
const fs = require("fs");
const OUT = process.argv[2], STATE = process.argv[3], BRIEF = process.env.BRIEF_TOKEN || "";
const DEAL = process.env.DEAL_ID, MEET = process.env.MEETING_ID;
const W = 1200, H = 1500;
const json = (r, body) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const ASK_Q = "Build a board deck and a revenue model for the Acme EMEA expansion";
const ASK_A = "Done — both are built from your four Acme calls, Priya's emails and the usage data.\n\n**Deck (4 slides):** adoption is at 35 of 40 seats, the 10-seat EMEA expansion adds about $62K a year at the current rate, and EU data residency is the one open question before signature.\n[Download Acme Robotics — EMEA expansion.pptx](/api/exports/demo.pptx?name=deck)\n\n**Model (3 years):** $62K → $81K → $99K, $242K cumulative. Inputs are in blue on the Assumptions sheet.\n[Download Acme Robotics — EMEA expansion model.xlsx](/api/exports/demo.xlsx?name=model)\n\n**Suggested next steps**\n- Send Priya the quote today\n- Get engineering's EU hosting answer by Thursday";
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, storageState: STATE });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("anchor.whatsNew.seen", "2026-10-morning-brief"); } catch {}
    document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important} *{caret-color:transparent}"; document.head.appendChild(s); });
  });
  await ctx.route("**/api/team/ticker", r => json(r, { items: [
    { text: "S&P 500 +0.6% as software names lead", direction: "up" }, { text: "Robotics ETF +1.8% on warehouse automation demand", direction: "up" },
    { text: "10-yr Treasury yield 4.12%", direction: "down" }, { text: "EU AI Act guidance due next month", direction: "flat" }, { text: "Nasdaq +0.9%", direction: "up" } ] }));
  await ctx.route("**/api/team/briefing", r => json(r, { dailyBriefing: "Warehouse-automation spend is up again this quarter — two of your accounts (Acme, Globex) sit right in it. EU data-residency rules are tightening for SaaS vendors, worth having an answer ready for EMEA buyers.", dailyBriefingUpdatedAt: new Date().toISOString() }));
  await ctx.route("**/api/meetings/call-feedback", r => json(r, { pending: null }));
  await ctx.route("**/api/morning-brief/pending", r => json(r, { pending: null }));
  await ctx.route("**/api/ask", async r => { await new Promise(x => setTimeout(x, 300)); r.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: ASK_A }); });
  await ctx.route(`**/api/deals/${DEAL}/brief`, r => json(r, { generatedAt: new Date().toISOString(), brief: {
    summary: "Acme is 7 months in, 35 of 40 seats active, and asking to add 10 EMEA seats. The expansion hinges on one thing: a real answer for Priya on EU data residency.",
    people: [{ name: "Priya Shah (CTO)", note: "Final sign-off. Wants EMEA call data kept in-region before she approves." }, { name: "Jordan Weiss (VP Eng)", note: "Champion. Pushing to have the EMEA team live next quarter." }],
    openItems: ["Formal quote for 10 EMEA seats at the current per-seat rate", "EU data residency answer from engineering", "Real date for the Slack integration"],
    questions: ["What does Priya need in writing to approve?", "Who on the EMEA team should we onboard first?"],
    watchOut: ["Don't promise EU hosting until engineering confirms", "Custom SSO or Slack work needs Lucia's OK first"] } }));
  await ctx.route(`**/api/meetings/${MEET}/follow-up-draft`, r => json(r, { recipientEmails: ["jordan.weiss@acmerobotics-demo.com", "priya.shah@acmerobotics-demo.com"], draft: {
    subject: "Acme EMEA expansion — next steps",
    body: "Hi Jordan, Priya —\n\nThanks for today. Quick recap of what we agreed:\n\n• 10 EMEA seats at your existing per-seat rate — formal quote attached today\n• EU data residency: I'll have a written answer from our engineering lead by Thursday\n• Slack integration: I'll come back with a real date, not \"soon\"\n\nOnce Priya has the residency answer, we can move straight to signature.\n\nBest,\nSam" } }));
  await ctx.route(`**/api/meetings/${MEET}/crm-update`, r => json(r, {
    snapshot: { provider: "salesforce", recordName: "Acme Robotics — EMEA Expansion", recordUrl: "https://example.my.salesforce.com/006DEMO000001", stage: "Qualification", stageOptions: [{ value: "Qualification", label: "Qualification" }, { value: "Proposal/Price Quote", label: "Proposal/Price Quote" }, { value: "Negotiation/Review", label: "Negotiation/Review" }, { value: "Closed Won", label: "Closed Won" }], closeDate: "2026-12-31", amount: 50000, nextStep: "Discovery" },
    proposal: { stage: { value: "Proposal/Price Quote", reason: "You agreed to send a formal quote today." }, closeDate: { value: "2026-11-28", reason: "Jordan wants the EMEA team live next quarter." }, amount: { value: 62000, reason: "10 seats at the existing $6,200 per-seat rate." }, nextStep: { value: "Send quote; EU residency answer by Thu", reason: "Both promised on the call." } } }));
  await ctx.route(`**/api/meetings/${MEET}/suggested-invites`, r => json(r, { timeZone: "UTC", suggestions: [
    { title: "Acme — EU data residency review", startISO: "2026-10-23T10:00:00", durationMinutes: 30, attendees: ["priya.shah@acmerobotics-demo.com", "jordan.weiss@acmerobotics-demo.com"], sourceQuote: "Let's get on a call Thursday once you have the residency answer.", confidence: "high" } ] }));
  await ctx.route("**/api/insights", r => json(r, { dealCount: 3, insights: {
    patterns: ["Buyers raise data residency and security in the first two calls — have the SOC 2 and hosting answers ready early.", "Deals that get a recap email within an hour move to the next stage twice as fast."],
    atRisk: [{ dealName: "Globex Industries — New Business", reason: "No call in 8 days and the proposal deck you promised hasn't gone out." }, { dealName: "Initech — Renewal", reason: "Casey wants to cut seats from 25 to 20 before signing." }],
    commonThemes: ["Slack integration requests", "Per-seat pricing at expansion", "EU data residency"] } }));

  const p = await ctx.newPage();
  const go = async (u) => { await p.goto("http://localhost:3000" + u, { waitUntil: "networkidle" }).catch(()=>{}); await p.waitForTimeout(1200); };
  const shot = async (n) => { await p.waitForTimeout(500); await p.screenshot({ path: OUT + "/" + n + ".png" }); console.log("shot", n); };
  const toEl = async (pg, sel, off) => {
    await pg.locator(sel).first().evaluate((el, off) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off), off);
    await pg.waitForTimeout(1500);
  };
  const anon = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await anon.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(s); }));
  const lp = await anon.newPage();
  await lp.goto("http://localhost:3000/", { waitUntil: "networkidle" }); await lp.waitForTimeout(2500);
  const sections = [["landing-how", "One thread through every deal"], ["landing-live", "Every call, understood in real time"], ["landing-what", "Everything that used to live in one"], ["landing-industry", "Anchor speaks your industry"]];
  for (const [n, txt] of sections) {
    await toEl(lp, 'h2:has-text("' + txt + '")', 140); await lp.mouse.wheel(0, 40); await lp.waitForTimeout(2500);
    await lp.screenshot({ path: OUT + "/" + n + ".png" }); console.log("shot", n);
  }
  await go("/dashboard/meetings/" + MEET);
  for (const label of ["Draft a follow-up email", "Suggest updates", "Find follow-up meetings"]) {
    const btn = p.locator('button:has-text("' + label + '")').first();
    if (await btn.count()) { await btn.click(); await p.waitForTimeout(1500); }
  }
  await p.evaluate(() => window.scrollTo(0, 0)); await shot("m-top");
  await toEl(p, 'text="Follow-up email"', 90); await shot("m-email");
  await toEl(p, 'text="Suggested invites"', 90); await shot("m-invites");
  await toEl(p, 'text="Update Salesforce"', 90); await shot("m-crm");
  await go("/dashboard/deals/" + DEAL); await p.click('button:has-text("After")'); await p.waitForTimeout(1200);
  await toEl(p, 'text=/share next steps/i', 90); await shot("deal-share");
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
