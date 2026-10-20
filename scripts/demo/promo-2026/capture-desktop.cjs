const { chromium } = require("playwright");
const S = process.argv[2];
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox","--allow-file-access-from-files"] });
  const p = await (await b.newContext({ viewport: { width: 860, height: 720 }, deviceScaleFactor: 2 })).newPage();
  await p.goto("file://" + S + "/renderer/index.html"); await p.waitForTimeout(800);
  await p.addStyleTag({ content: "*{caret-color:transparent}" });
  const shot = async n => { await p.waitForTimeout(250); await p.screenshot({ path: `${S}/out/${n}.png` }); console.log(n); };
  await shot("d0-idle");
  await p.evaluate(() => __emit("detected", { id: "w1", title: "Acme Robotics — EMEA expansion · Zoom" }));
  await shot("d1-detected");
  await p.evaluate(() => { __emit("started", { id: "w1", meetingId: "m1", dealId: "d1" }); meetings.get("w1").startedAt = Date.now() - (12*60+9)*1000; });
  await p.waitForTimeout(400);
  const lines = [["Jordan Weiss","Thanks for hopping on — the EMEA team is confirmed, 10 people starting next quarter."],["Sam Rivera","Great news. I can match your existing per-seat rate for those 10."],["Priya Shah","Before I sign off — can their call data stay in the EU?"]];
  for (const [s,t] of lines.slice(0,2)) await p.evaluate(([s,t]) => __emit("line", { windowId: "w1", speaker: s, text: t }), [s,t]);
  await shot("d2-recording");
  await p.evaluate(([s,t]) => __emit("line", { windowId: "w1", speaker: s, text: t }), lines[2]);
  const sugg = (writing) => ({
    liveQuestion: { question: "Can their call data stay in the EU?", askedBy: "Priya Shah", answering: writing, suggestedAnswer: writing ? null : "Today everything runs in the US under our SOC 2 boundary. Let me get you a definite answer on EU residency from engineering by Thursday — I won't guess on this one.", caution: { level: "amber", reason: "EU hosting isn't confirmed — the deal notes say engineering must answer first." } },
    offLimits: [{ label: "Committing to EU hosting", raised: true }, { label: "Discounts over 15%", raised: false }, { label: "Custom SSO / Slack work", raised: false }],
    summary: ["EMEA expansion confirmed: 10 seats next quarter", "You offered the existing per-seat rate", "Priya's sign-off hinges on EU data residency"],
    checklist: [{ label: "Confirm seat count and start date", covered: true }, { label: "Agree on pricing", covered: true }, { label: "Data residency answer", covered: false }, { label: "Slack integration timing", covered: false }],
    nudges: ["Ask who on the EMEA team should onboard first", "Jordan raised Slack last quarter — give a real date"] });
  await p.evaluate((s) => __emit("sugg", { windowId: "w1", suggestions: s }), sugg(true));
  await shot("d3-writing");
  await p.evaluate((s) => __emit("sugg", { windowId: "w1", suggestions: s }), sugg(false));
  await shot("d4-answer");
  await p.evaluate(() => { const el = document.querySelector("#meetings"); });
  const q = "What did we promise them last quarter?";
  const inp = p.locator(".ask-input");
  await inp.scrollIntoViewIfNeeded();
  await shot("d5-askpanel");
  for (let i = 1; i <= 6; i++) { await inp.fill(q.slice(0, Math.round(q.length*i/6))); await shot(`d6-type-${i}`); }
  await p.evaluate(() => { window.__askAnswer = "At the Q3 review you promised Jordan a real date for the Slack integration — it's still open. You also said EMEA pricing would match their current per-seat rate, which you just honored."; });
  await p.click(".ask-btn"); await p.waitForTimeout(600);
  await shot("d7-asked");
  const cb = p.locator('input[data-task-id="t1"]'); await cb.scrollIntoViewIfNeeded(); await shot("d8-tasks"); await cb.check(); await shot("d9-taskdone");
  console.log(await p.evaluate(() => document.body.scrollHeight + " " + document.documentElement.scrollHeight));
  await p.screenshot({ path: `${S}/out/full.png`, fullPage: true });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
