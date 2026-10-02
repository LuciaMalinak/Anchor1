// Keeps Anchor Desktop running in the background on a Mac, the way
// Granola does, so it can notice a call the moment one starts — nothing
// can detect a meeting while the app isn't running at all.
//
// A per-user LaunchAgent (~/Library/LaunchAgents) instead of Electron's
// login-item setting, for two things the login item can't do:
// - start the app silently at login (it's passed BACKGROUND_ARG, so no
//   window and no Dock icon — just the menu bar icon, until a call), and
// - start it again if it crashes. KeepAlive only reacts to an
//   unsuccessful exit, so choosing "Quit Anchor Desktop" (a clean exit)
//   still keeps it off until the next login.
import { app } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const LABEL = "com.anchor.desktop.background";
export const BACKGROUND_ARG = "--background";

function plistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plistFor(execPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(execPath)}</string>
    <string>${BACKGROUND_ARG}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`;
}

// Only for an installed Mac app: running unpacked (npm start) has no
// stable app to point at, and a copy macOS is running straight from the
// downloaded .dmg (App Translocation) lives at a temporary path that
// won't exist after a restart.
export function canUseBackgroundAgent(): boolean {
  return process.platform === "darwin" && app.isPackaged && !process.execPath.includes("/AppTranslocation/");
}

export function isBackgroundAgentInstalled(): boolean {
  return fs.existsSync(plistPath());
}

// Writes the agent (or rewrites it if the app has moved). Returns true
// when it changed anything. Takes effect from the next login — the copy
// that's running now keeps running either way.
export function installBackgroundAgent(): boolean {
  const wanted = plistFor(process.execPath);
  try {
    if (fs.readFileSync(plistPath(), "utf8") === wanted) return false;
  } catch {
    // Not there yet.
  }
  fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
  fs.writeFileSync(plistPath(), wanted);
  return true;
}

export function removeBackgroundAgent(): void {
  fs.rmSync(plistPath(), { force: true });
}
