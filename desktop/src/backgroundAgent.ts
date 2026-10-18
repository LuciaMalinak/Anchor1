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
//   still kept it off until the next login — which is how Anchor missed
//   calls that Granola caught: quit it once (or have an update or a
//   reinstall stop it) and nothing noticed calls again until the next
//   restart. Now launchd also checks every few minutes (StartInterval)
//   and starts it again if it isn't running.
//
// On Windows the same job is done by a per-user scheduled task that
// starts it in the background every few minutes if it isn't running
// (Windows' own "run at login" entry only ever starts it at login).
//
// A copy started while Anchor is already running exits straight away —
// see requestSingleInstanceLock in main.ts.
import { app } from "electron";
import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const LABEL = "com.anchor.desktop.background";
export const BACKGROUND_ARG = "--background";
// How often launchd / Task Scheduler start Anchor again if it isn't running.
const RESTART_CHECK_SECONDS = 180;
const WINDOWS_TASK = "Anchor Desktop - keep watching for calls";

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
  <key>StartInterval</key>
  <integer>${RESTART_CHECK_SECONDS}</integer>
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

function run(cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${stdout}${stderr}`.trim() });
    });
  });
}

// Loads the agent into launchd now, so the restart check works from
// today rather than from the next login. Only when it isn't loaded
// already: reloading a loaded one would stop the copy launchd started,
// which may be this very app. An agent that changed while loaded picks
// the change up at the next login.
export async function loadBackgroundAgentNow(): Promise<string | null> {
  if (!canUseBackgroundAgent() || !isBackgroundAgentInstalled() || typeof process.getuid !== "function") return null;
  const domain = `gui/${process.getuid()}`;
  if ((await run("/bin/launchctl", ["print", `${domain}/${LABEL}`])).ok) return null;
  const result = await run("/bin/launchctl", ["bootstrap", domain, plistPath()]);
  return result.ok ? "Started watching for calls in the background." : `Couldn't load the background agent: ${result.output}`;
}

// Windows: an installed app (not `npm start`).
export function canUseWindowsWatchdog(): boolean {
  return process.platform === "win32" && app.isPackaged;
}

// The scheduled task that starts Anchor again within a few minutes if it
// isn't running. Rewritten on every launch (cheap, and follows the app if
// it's reinstalled somewhere else); runs only while the person is signed
// in, and needs no admin rights.
export async function installWindowsWatchdog(): Promise<string | null> {
  if (!canUseWindowsWatchdog()) return null;
  const result = await run("schtasks", [
    "/Create",
    "/F",
    "/TN",
    WINDOWS_TASK,
    "/SC",
    "MINUTE",
    "/MO",
    String(Math.max(1, Math.round(RESTART_CHECK_SECONDS / 60))),
    "/TR",
    `"${process.execPath}" ${BACKGROUND_ARG}`,
  ]);
  return result.ok ? null : `Couldn't set Anchor to restart itself: ${result.output}`;
}

export async function removeWindowsWatchdog(): Promise<void> {
  if (process.platform !== "win32") return;
  await run("schtasks", ["/Delete", "/F", "/TN", WINDOWS_TASK]);
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
