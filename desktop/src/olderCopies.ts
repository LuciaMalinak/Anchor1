// Windows: stops an older Anchor Desktop that's still running from
// another install, so the version just installed is the one that runs.
//
// Without this, installing the new version didn't take: the old copy
// (installed before automatic updates existed, sometimes in a different
// folder) kept running in the tray, and opening the new one only brought
// the old window forward — the new copy saw "already running" (the
// single-instance lock in main.ts) and quit. Someone could reinstall as
// often as they liked and still see the old app.
//
// Only a copy from a different .exe whose version is older than this one
// is stopped; this copy's own processes, and anything the same age or
// newer, are left alone.
import { app } from "electron";
import { execFileSync } from "child_process";

type RunningCopy = { Id: number; Path: string | null; Version: string | null };

function parseVersion(v: string | null): number[] | null {
  const m = v ? /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim()) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isOlder(theirs: number[], ours: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (theirs[i] !== ours[i]) return theirs[i] < ours[i];
  }
  return false;
}

// Returns how many processes it stopped. Never throws.
export function stopOlderCopies(log: (message: string) => void): number {
  if (process.platform !== "win32" || !app.isPackaged) return 0;
  const ours = parseVersion(app.getVersion());
  if (!ours) return 0;
  let copies: RunningCopy[];
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Process -Name 'Anchor Desktop' -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Id = $_.Id; Path = $_.Path; Version = $(if ($_.Path) { (Get-Item -LiteralPath $_.Path).VersionInfo.ProductVersion } else { $null }) } } | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 10_000, encoding: "utf8" }
    ).trim();
    if (!out) return 0;
    const parsed = JSON.parse(out) as RunningCopy | RunningCopy[];
    copies = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return 0;
  }
  const ownPath = process.execPath.toLowerCase();
  const older = copies.filter((c) => {
    if (c.Id === process.pid || !c.Path || c.Path.toLowerCase() === ownPath) return false;
    const theirs = parseVersion(c.Version);
    return Boolean(theirs && isOlder(theirs, ours));
  });
  let stopped = 0;
  for (const c of older) {
    try {
      process.kill(c.Id);
      stopped++;
    } catch {
      // Already gone, or not ours to stop.
    }
  }
  if (stopped) log(`Closed an older Anchor Desktop (${older[0].Version}) that was still running from ${older[0].Path}.`);
  return stopped;
}
