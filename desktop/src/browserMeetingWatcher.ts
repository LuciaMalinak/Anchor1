// Windows only: a backstop for Recall's Desktop SDK, which on Windows
// doesn't detect Zoom or Teams running in a web browser, and which records
// nothing at all if it misses a call in the desktop apps.
//
// A call counts as live when:
// - in a browser (Chrome, Edge, Firefox): Windows reports that browser is
//   using the microphone right now AND one of its windows has a Zoom or
//   Teams meeting title. Chrome and Edge title a window after its active
//   tab, so a meeting in a background tab isn't seen until that tab is
//   shown.
// - in the Zoom or Teams desktop app: that app has held the microphone for
//   DESKTOP_CONFIRM_POLLS checks in a row, which gives Recall's own
//   detection the first chance (main.ts stands aside when it has one).
//
// Microphone use comes from the registry: each app that has used the mic
// gets a key under ConsentStore\microphone (desktop programs under
// NonPackaged, Store apps like new Teams directly), and while it still
// holds the mic its LastUsedTimeStop is 0.
//
// One PowerShell process does the checking for as long as the app runs and
// prints a JSON line every few seconds, rather than starting a new
// PowerShell (about half a second of CPU) on every check.
import { spawn, type ChildProcess } from "child_process";

const POLL_SECONDS = 5;
// Released mic polls in a row before a call counts as over. Rides out
// muting or switching devices, which can briefly release the mic.
const RELEASED_POLLS_TO_END = 3;
const DESKTOP_CONFIRM_POLLS = 2;
const RESTART_DELAY_MS = 30_000;

type AppKey = "chrome" | "msedge" | "firefox" | "zoom" | "teams";

const APPS: Record<AppKey, { name: string; browser: boolean; platform?: string }> = {
  chrome: { name: "Chrome", browser: true },
  msedge: { name: "Edge", browser: true },
  firefox: { name: "Firefox", browser: true },
  zoom: { name: "the Zoom app", browser: false, platform: "Zoom" },
  teams: { name: "the Teams app", browser: false, platform: "Teams" },
};

const MEETING_TITLES: { platform: string; pattern: RegExp }[] = [
  { platform: "Teams", pattern: /microsoft teams/i },
  // The Zoom web client's own titles ("Zoom Meeting", "Zoom Webinar",
  // "Zoom Workplace", or just "Zoom"), not any page with "zoom" in it.
  { platform: "Zoom", pattern: /^zoom( (meeting|webinar|workplace))?(\s+[-–—]\s|$)/i },
];

const SCRIPT = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$helper = $true
try {
  Add-Type -ErrorAction Stop -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class AnchorWindows {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  public static List<string> Titles() {
    var titles = new List<string>();
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      var text = new StringBuilder(512);
      if (GetWindowText(hWnd, text, text.Capacity) == 0) return true;
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      titles.Add(processId + "\t" + text);
      return true;
    }, IntPtr.Zero);
    return titles;
  }
}
"@
} catch {
  $helper = $false
  [Console]::Out.WriteLine((@{ error = "Couldn't load the window reader, so only each browser's front window is checked: $($_.Exception.Message)" } | ConvertTo-Json -Compress))
}
$micRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
while ($true) {
  $mic = @()
  $keys = @(Get-ChildItem $micRoot -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -ne 'NonPackaged' })
  $keys += @(Get-ChildItem "$micRoot\NonPackaged" -ErrorAction SilentlyContinue)
  foreach ($app in $keys) {
    $usage = Get-ItemProperty $app.PSPath -ErrorAction SilentlyContinue
    if ($usage -and $usage.LastUsedTimeStop -eq 0 -and $usage.LastUsedTimeStart -gt 0) { $mic += $app.PSChildName }
  }
  $browserByProcess = @{}
  $procs = @(Get-Process chrome, msedge, firefox -ErrorAction SilentlyContinue)
  foreach ($proc in $procs) { $browserByProcess[[int]$proc.Id] = $proc.ProcessName.ToLower() }
  $windows = @()
  if ($helper) {
    foreach ($line in [AnchorWindows]::Titles()) {
      $parts = $line.Split([char]9, 2)
      $browser = $browserByProcess[[int]$parts[0]]
      if ($browser) { $windows += @{ browser = $browser; title = $parts[1] } }
    }
  } else {
    foreach ($proc in $procs) {
      if ($proc.MainWindowTitle) { $windows += @{ browser = $proc.ProcessName.ToLower(); title = $proc.MainWindowTitle } }
    }
  }
  [Console]::Out.WriteLine((@{ mic = $mic; windows = $windows; micKeys = $keys.Count } | ConvertTo-Json -Compress -Depth 3))
  [Console]::Out.Flush()
  Start-Sleep -Seconds ${POLL_SECONDS}
}
`;

type Snapshot = {
  mic?: string[] | string | { value: string[] };
  windows?: { browser: string; title: string }[] | { browser: string; title: string } | { value: { browser: string; title: string }[] };
  micKeys?: number;
  error?: string;
};

export type DetectedCall = { platform: string; where: string; title: string };

type Handlers = {
  log: (message: string) => void;
  onMeetingStart: (call: DetectedCall) => void;
  onMeetingEnd: (call: DetectedCall) => void;
};

// Desktop programs' keys are their full path with "#" for "\", e.g.
// C:#Program Files#Google#Chrome#Application#chrome.exe or
// C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe. Store apps' keys are
// their package family name, e.g. MSTeams_8wekyb3d8bbwe for new Teams.
export function appForMicKey(key: string): AppKey | null {
  if (/^MSTeams_/i.test(key)) return "teams";
  const exe = key.split("#").pop()?.toLowerCase().replace(/\.exe$/, "") ?? "";
  if (exe === "chrome" || exe === "msedge" || exe === "firefox") return exe;
  if (exe === "zoom") return "zoom";
  if (exe === "teams" || exe === "ms-teams") return "teams";
  return null;
}

// PowerShell turns a one-item list into the item itself, and Windows
// PowerShell 5.1 can write a list as {"value": [...], "Count": n}.
function asArray<T>(value: T[] | T | { value: T[] } | null | undefined): T[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && Array.isArray((value as { value?: unknown }).value)) return (value as { value: T[] }).value;
  return [value as T];
}

export function startBrowserMeetingWatcher(handlers: Handlers): () => void {
  const { log } = handlers;
  let proc: ChildProcess | null = null;
  let stopped = false;
  let restartTimer: NodeJS.Timeout | null = null;
  let reportedFirstCheck = false;

  // App -> how many checks in a row it has held the mic.
  let micPolls = new Map<AppKey, number>();
  let current: (DetectedCall & { app: AppKey }) | null = null;
  let releasedPolls = 0;

  function startCall(app: AppKey, platform: string, title: string, why: string) {
    current = { app, platform, where: APPS[app].name, title };
    releasedPolls = 0;
    log(`${platform} call found in ${APPS[app].name}: ${why}`);
    handlers.onMeetingStart(current);
  }

  function handleSnapshot(snapshot: Snapshot) {
    if (snapshot.error) {
      log(snapshot.error);
      return;
    }
    const usingMic = new Set(
      asArray(snapshot.mic)
        .map(appForMicKey)
        .filter((a): a is AppKey => a !== null)
    );
    const windows = asArray(snapshot.windows);
    if (!reportedFirstCheck) {
      reportedFirstCheck = true;
      log(
        `Call check is running: ${snapshot.micKeys ?? 0} apps in Windows' microphone list, ${windows.length} browser windows open.`
      );
    }
    for (const a of usingMic) if (!micPolls.has(a)) log(`${APPS[a].name[0].toUpperCase()}${APPS[a].name.slice(1)} started using the microphone.`);
    for (const a of micPolls.keys()) if (!usingMic.has(a)) log(`${APPS[a].name[0].toUpperCase()}${APPS[a].name.slice(1)} stopped using the microphone.`);
    micPolls = new Map([...usingMic].map((a) => [a, (micPolls.get(a) ?? 0) + 1]));

    if (current) {
      if (usingMic.has(current.app)) {
        releasedPolls = 0;
        return;
      }
      releasedPolls++;
      if (releasedPolls >= RELEASED_POLLS_TO_END) {
        const ended = current;
        current = null;
        releasedPolls = 0;
        log(`${ended.platform} call in ${ended.where} ended (the microphone has been released for ${RELEASED_POLLS_TO_END * POLL_SECONDS}s).`);
        handlers.onMeetingEnd(ended);
      }
      return;
    }

    for (const window of windows) {
      const app = appForMicKey(window.browser);
      if (!app || !APPS[app].browser || !usingMic.has(app)) continue;
      const match = MEETING_TITLES.find((m) => m.pattern.test(window.title));
      if (!match) continue;
      startCall(app, match.platform, window.title, `"${window.title}", which is using the microphone.`);
      return;
    }

    for (const [app, polls] of micPolls) {
      const platform = APPS[app].platform;
      if (!platform || polls < DESKTOP_CONFIRM_POLLS) continue;
      startCall(app, platform, `${platform} call`, `it has been using the microphone for ${polls * POLL_SECONDS}s.`);
      return;
    }
  }

  function launch() {
    restartTimer = null;
    const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
    proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      windowsHide: true,
    });
    log("Watching for Zoom and Teams calls (desktop apps, and Chrome, Edge and Firefox).");

    let buffer = "";
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleSnapshot(JSON.parse(line) as Snapshot);
        } catch (err) {
          log(`The call check returned something unreadable: ${err instanceof Error ? err.message : err}`);
        }
      }
    });
    let stderr = "";
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-500);
    });
    proc.on("error", (err) => log(`Couldn't run the call check: ${err.message}`));
    proc.on("exit", (code) => {
      proc = null;
      if (stopped) return;
      const detail = stderr.trim() ? ` PowerShell said: ${stderr.trim().split(/\r?\n/).slice(-2).join(" ")}` : "";
      log(`The call check stopped (exit code ${code}); restarting it in ${RESTART_DELAY_MS / 1000}s.${detail}`);
      stderr = "";
      restartTimer = setTimeout(launch, RESTART_DELAY_MS);
    });
  }

  launch();
  return () => {
    stopped = true;
    if (restartTimer) clearTimeout(restartTimer);
    proc?.kill();
  };
}
