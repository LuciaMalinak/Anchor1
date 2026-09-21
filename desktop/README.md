# Anchor Desktop (Phase 1)

Records Zoom, Teams, and Google Meet calls straight from your computer — no bot ever joins the call, the way Granola does it. This uses Recall.ai's Desktop Recording SDK under the hood, the same account/API key the web app's "Send Anchor to a live meeting" feature already uses.

**Where this stands:** Phase 1 only — proving the no-bot recording actually makes it through Anchor's pipeline (record locally → upload to Recall → Anchor downloads it → transcribe → summarize → shows up in your dashboard as "ready"). Live transcript/coaching/Ask Anchor *during* the call (Phase 2) and a real installer you can just double-click (Phase 4 — code signing, notarization, auto-updates) come later. Right now this only runs from source, and only on:

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
