const { chromium } = require("playwright");
const { spawn } = require("child_process");
const C = process.argv[2], OUT = process.argv[3], DUR = 60, FPS = 30;
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox","--allow-file-access-from-files"] });
  const p = await (await b.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
  p.on("pageerror", e => console.log("ERR", e.message));
  await p.goto("file://" + C + "/composer.html"); await p.evaluate(() => window.ready); await p.waitForTimeout(500);
  const ff = spawn("ffmpeg", ["-v","error","-y","-f","image2pipe","-framerate",String(FPS),"-c:v","mjpeg","-i","-","-c:v","libx264","-preset","slow","-crf","17","-pix_fmt","yuv420p","-r",String(FPS), OUT], { stdio: ["pipe","inherit","inherit"] });
  const N = DUR * FPS;
  for (let i = 0; i < N; i++) {
    await p.evaluate(t => render(t), i / FPS);
    const buf = await p.screenshot({ type: "jpeg", quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
    if (i % 150 === 0) console.log("frame", i);
  }
  ff.stdin.end(); await new Promise(r => ff.on("close", r)); await b.close(); console.log("done");
})();
