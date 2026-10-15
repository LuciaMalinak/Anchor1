// Windows only: notices a Zoom or Teams call running in a web browser,
// which Recall's Desktop SDK doesn't detect on Windows (it only sees the
// Zoom/Teams desktop apps, and Google Meet in Chrome/Edge).
//
// A call counts as live when both are true for the same browser:
// - Windows reports that browser is using the microphone right now. Each
//   app that has used the mic gets a key under the registry path below;
//   while it still holds the mic, its LastUsedTimeStop is 0.
// - One of that browser's windows has a Zoom or Teams meeting title.
//   Chrome and Edge title a window after its active tab, so a meeting in a
//   background tab isn't seen until that tab is shown.
//
// One PowerShell process does the checking for as long as the app runs and
// prints a JSON line every few seconds, rather than starting a new
// PowerShell (about half a second of CPU) on every check.
import { spawn, type ChildProcess } from "child_process";

const POLL_SECONDS = 5;
// Released mic polls in a row before a call counts as over. Rides out
// muting or switching devices, which can briefly release the mic.
const RELEASED_POLLS_TO_END = 3;
const RESTART_DELAY_MS = 30_000;

const BROWSERS = ["chrome", "msedge", "firefox"] as const;
type Browser = (typeof BROWSERS)[number];

const BROWSER_NAMES: Record<Browser, string> = { chrome: "Chrome", msedge: "Edge", firefox: "Firefox" };

const MEETING_TITLES: { platform: string; pattern: RegExp }[] = [
  { platform: "Teams", pattern: /microsoft teams/i },
  // The Zoom web client's own titles ("Zoom Meeting", "Zoom Webinar",
  // "Zoom Workplace", or just "Zoom"), not any page with "zoom" in it.
  { platform: "Zoom", pattern: /^zoom( (meeting|webinar|workplace))?(\s+[-\u2013\u2014]\s|$)/i },
];

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
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
$micKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged'
while ($true) {
  $mic = @()
  foreach ($app in Get-ChildItem $micKey) {
    $usage = Get-ItemProperty $app.PSPath
    if ($usage.LastUsedTimeStop -eq 0 -and $usage.LastUsedTimeStart -gt 0) { $mic += $app.PSChildName }
  }
  $browserByProcess = @{}
  foreach ($proc in Get-Process chrome, msedge, firefox) { $browserByProcess[[int]$proc.Id] = $proc.ProcessName.ToLower() }
  $windows = @()
  foreach ($line in [AnchorWindows]::Titles()) {
    $parts = $line.Split([char]9, 2)
    $browser = $browserByProcess[[int]$parts[0]]
    if ($browser) { $windows += @{ browser = $browser; title = $parts[1] } }
  }
  [Console]::Out.WriteLine((@{ mic = $mic; windows = $windows } | ConvertTo-Json -Compress -Depth 3))
  [Console]::Out.Flush()
  Start-Sleep -Seconds ${POLL_SECONDS}
}
`;

type Snapshot = { mic: string[]; windows: { browser: string; title: string }[] };

export type BrowserMeeting = { browser: string; platform: string; title: string };

type Handlers = {
  log: (message: string) => void;
  onMeetingStart: (meeting: BrowserMeeting) => void;
  onMeetingEnd: (meeting: BrowserMeeting) => void;
};

// Registry key names are the app's full path with "#" for "\", e.g.
// C:#Program Files#Google#Chrome#Application#chrome.exe.
function browserForMicKey(key: string): Browser | null {
  const exe = key.split("#").pop()?.toLowerCase().replace(/\.exe$/, "");
  return BROWSERS.find((b) => b === exe) ?? null;
}

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function startBrowserMeetingWatcher(handlers: Handlers): () => void {
  const { log } = handlers;
  let proc: ChildProcess | null = null;
  let stopped = false;
  let restartTimer: NodeJS.Timeout | null = null;

  let micBrowsers = new Set<Browser>();
  let current: (BrowserMeeting & { browserKey: Browser }) | null = null;
  let releasedPolls = 0;

  function handleSnapshot(snapshot: Snapshot) {
    const nowUsingMic = new Set(
      asArray(snapshot.mic)
        .map(browserForMicKey)
        .filter((b): b is Browser => b !== null)
    );
    for (const b of nowUsingMic) if (!micBrowsers.has(b)) log(`${BROWSER_NAMES[b]} started using the microphone.`);
    for (const b of micBrowsers) if (!nowUsingMic.has(b)) log(`${BROWSER_NAMES[b]} stopped using the microphone.`);
    micBrowsers = nowUsingMic;

    if (current) {
      if (micBrowsers.has(current.browserKey)) {
        releasedPolls = 0;
        return;
      }
      releasedPolls++;
      if (releasedPolls >= RELEASED_POLLS_TO_END) {
        const ended = current;
        current = null;
        releasedPolls = 0;
        log(`${ended.platform} call in ${ended.browser} ended (the microphone has been released for ${RELEASED_POLLS_TO_END * POLL_SECONDS}s).`);
        handlers.onMeetingEnd(ended);
      }
      return;
    }

    for (const window of asArray(snapshot.windows)) {
      const browserKey = BROWSERS.find((b) => b === window.browser);
      if (!browserKey || !micBrowsers.has(browserKey)) continue;
      const match = MEETING_TITLES.find((m) => m.pattern.test(window.title));
      if (!match) continue;
      current = { browserKey, browser: BROWSER_NAMES[browserKey], platform: match.platform, title: window.title };
      releasedPolls = 0;
      log(`${match.platform} call found in ${current.browser}: "${window.title}", which is using the microphone.`);
      handlers.onMeetingStart(current);
      return;
    }
  }

  function launch() {
    restartTimer = null;
    const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
    proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      windowsHide: true,
    });
    log("Watching for Zoom and Teams calls in Chrome, Edge and Firefox.");

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
          log(`Browser call check returned something unreadable: ${err instanceof Error ? err.message : err}`);
        }
      }
    });
    proc.on("error", (err) => log(`Couldn't run the browser call check: ${err.message}`));
    proc.on("exit", (code) => {
      proc = null;
      if (stopped) return;
      log(`The browser call check stopped (exit code ${code}); restarting it in ${RESTART_DELAY_MS / 1000}s.`);
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
