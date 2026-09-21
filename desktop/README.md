# Anchor Desktop

Records Zoom, Teams, and Google Meet calls straight from your computer — no bot ever joins the call, the way Granola does it. This uses Recall.ai's Desktop Recording SDK under the hood, the same account/API key the web app's "Send Anchor to a live meeting" feature already uses.

**Where this stands:** the recording pipeline itself works end to end (record locally → upload to Recall → Anchor downloads it → transcribe → summarize → shows up in your dashboard as "ready"). Packaging (this doc's "Building an installer" section below) can now produce a real `.dmg`/`.exe` instead of everyone running it from source — but see the "About installing it on other people's computers" section before handing it to your team; there's one real prerequisite (an Apple Developer account) standing between "builds" and "team members can just double-click it with no warnings." Live transcript/coaching/Ask Anchor *during* the call is still a separate, not-yet-built phase — today it's record-now-get-the-summary-after, same as any other meeting once it's done. This only runs on:

- **Apple Silicon Macs** (M1/M2/M3/M4 — not Intel Macs)
- **Windows**

Recall's SDK doesn't support Intel Macs or Linux.

## One-time setup

1. Make sure you have [Node.js](https://nodejs.org) installed (18 or newer).
2. In Terminal, from the `anchor-mvp/desktop` folder:
   ```
   npm install
   ```
   This downloads Electron plus a native component from Recall specific to your Mac/Windows machine — it has to run on the actual computer you'll use, not somewhere else.
3. Build it:
   ```
   npm run build
   ```
4. In the Anchor web app, go to **Integrations → Anchor Desktop → Generate desktop token**. Copy the token shown (you only get to see it once).
5. Start the app:
   ```
   npm start
   ```
6. Paste the token into the app's "Paste your desktop token" box and click **Save token**.
7. **macOS only:** the first time it runs, macOS will ask you to grant Accessibility, Screen Recording, and Microphone permissions — say yes to all three (System Settings → Privacy & Security if you miss the prompt). Without these, Recall's SDK can't see or capture anything.

## Using it

Open a Zoom, Teams, or Meet call as you normally would (in the browser or the native app — doesn't matter). Anchor Desktop detects the window automatically and lists it under "Detected meetings." Click **Record** to start — nothing joins the call, nothing shows up in the participant list, it's entirely local. Click **Stop** when you're done. The recording uploads to Recall in the background; once that finishes, it flows into Anchor exactly like any other meeting and shows up in your dashboard once it's processed.

## If something's not working

The "Activity" panel at the bottom of the app logs everything it's doing — meeting detection, recording start/stop, and any errors from the SDK. That's the first place to look. Screenshotting that panel is the most useful thing to send back if a recording doesn't show up in Anchor afterward.

## Building an installer

Instead of everyone running `npm install`/`npm run build`/`npm start` from Terminal, this can be packaged into a real double-click installer:

```
npm install
npm run dist:mac      # produces a .dmg and .zip in desktop/release/ — run this ON a Mac
npm run dist:win       # produces a .exe installer in desktop/release/ — run this ON Windows
```

Each has to run on that actual platform — you can't build the Windows installer from a Mac or vice versa without extra tooling this doesn't set up.

### About installing it on other people's computers

An installer you build this way will **work**, but it isn't signed or notarized yet, so macOS Gatekeeper and Windows SmartScreen will both show a scary "unknown developer" warning the first time each person opens it. It's a one-time click-through per person (macOS: right-click the app → Open, instead of double-clicking; Windows: "More info" → "Run anyway") — annoying, but not broken, and fine for a small team who trusts where the file came from.

To make that warning go away entirely — the actual "download it, double-click it, no scary prompt" experience — two things have to happen, and only you can do them (they involve your identity/business and cost money, so I can't set them up on your behalf):

1. **Apple Developer Program membership** ($99/year, developer.apple.com) — lets the Mac build be code-signed and notarized by Apple. Once you have this, tell me and I'll wire the signing into the build config (it's a small change).
2. **A Windows code-signing certificate** (from a certificate authority like DigiCert or SSL.com, typically $100–400/year) — same idea for the Windows installer. Optional if your team's all on Mac.

Until then, the unsigned `.dmg`/`.exe` from the commands above is the realistic "easy enough for the team" option — genuinely easier than Terminal, just not zero-click.
