const { chromium } = require("playwright");
const S = process.argv[2];
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox","--allow-file-access-from-files"] });
  const p = await (await b.newContext({ viewport: { width: 860, height: 720 }, deviceScaleFactor: 2 })).newPage();
  await p.goto("file://" + S + "/v2/desk/renderer/index.html"); await p.waitForTimeout(800);
  await p.addStyleTag({ content: "*{caret-color:transparent}" });
  const shot = async n => { await p.waitForTimeout(250); await p.screenshot({ path: `${S}/v2/desk/${n}.png` }); console.log(n); };
  await shot("d0-idle");
  await p.evaluate(() => __emit("detected", { id: "w1", title: "Acme Robotics — EMEA expansion · Zoom" }));
  await shot("d1-detected");
  await p.evaluate(() => { __emit("started", { id: "w1", meetingId: "m1", dealId: "d1" }); meetings.get("w1").startedAt = Date.now() - (12*60+9)*1000; });
  await p.waitForTimeout(400);
  const lines = [["Jordan Weiss","Thanks for hopping on — the EMEA team is confirmed, 10 people starting next quarter."],["Maya Chen","Great news. We can match your existing per-seat rate for those 10."],["Priya Shah","Before I sign off — can their call data stay in the EU?"]];
  for (const [s,t] of lines.slice(0,2)) await p.evaluate(([s,t]) => __emit("line", { windowId: "w1", speaker: s, text: t }), [s,t]);
  await shot("d2-recording");
  await p.evaluate(([s,t]) => __emit("line", { windowId: "w1", speaker: s, text: t }), lines[2]);
  const sugg = (writing) => ({
    liveQuestion: { question: "Can their call data stay in the EU?", askedBy: "Priya Shah", answering: writing, suggestedAnswer: writing ? null : "Today everything runs in the US under our SOC 2 boundary. Sam promised you a definite answer from engineering by Thursday, and you'll have it in writing — we won't guess on this one.", caution: { level: "amber", reason: "Sam hasn't approved EU hosting — Sam's notes say engineering must confirm first." } },
    offLimits: [{ label: "Committing to EU hosting", raised: true }, { label: "Discounts over 15%", raised: false }, { label: "Custom SSO / Slack work", raised: false }],
    summary: ["EMEA expansion confirmed: 10 seats next quarter", "You offered the existing per-seat rate", "Priya's sign-off hinges on EU data residency"],
    checklist: [{ label: "Confirm seat count and start date", covered: true }, { label: "Agree on pricing", covered: true }, { label: "Data residency answer", covered: false }, { label: "Slack integration timing", covered: false }],
    nudges: ["Ask who on the EMEA team should onboard first", "Jordan raised Slack last quarter — give a real date"] });
  await p.evaluate((s) => __emit("sugg", { windowId: "w1", suggestions: s }), sugg(true));
  await shot("d3-writing");
  await p.evaluate((s) => __emit("sugg", { windowId: "w1", suggestions: s }), sugg(false));
  await shot("d4-answer");
  await p.evaluate(() => { const el = document.querySelector("#meetings"); });
  const q = "Priya wants 20% off. How would Sam handle it?";
  const inp = p.locator(".ask-input");
  await inp.scrollIntoViewIfNeeded();
  await shot("d5-askpanel");
  for (let i = 1; i <= 8; i++) { await inp.fill(q.slice(0, Math.round(q.length*i/8))); await shot(`d6-type-${i}`); }
  await p.evaluate(() => { window.__askAnswer = "Sam never discounts on a first ask. Hold the per-seat rate and offer to lock it for two years instead — that's how Sam closed the original 40 seats. You can go up to 15% if she pushes; anything beyond that, say you'll take it to Sam."; });
  await p.click(".ask-btn"); await p.waitForTimeout(600);
  await shot("d7-asked");
  console.log(await p.evaluate(() => document.body.scrollHeight + " " + document.documentElement.scrollHeight));
  await p.screenshot({ path: `${S}/v2/desk/full.png`, fullPage: true });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
