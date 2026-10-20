const { chromium } = require("playwright");
const C = process.argv[2], times = process.argv.slice(3).map(Number);
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox","--allow-file-access-from-files"] });
  const p = await (await b.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
  p.on("pageerror", e => console.log("ERR", e.message));
  await p.goto("file://" + C + "/composer.html"); await p.evaluate(() => window.ready);
  for (const t of times) { await p.evaluate(t => render(t), t); await p.waitForTimeout(150); await p.screenshot({ path: `${C}/preview/${t}.jpg`, type: "jpeg", quality: 80 }); }
  await b.close();
})();
