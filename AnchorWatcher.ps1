<#
  Anchor Meeting Watcher
  Runs quietly in the background and opens Anchor as soon as a meeting starts:
  Zoom, Microsoft Teams or Google Meet - desktop app or browser.

  How it detects a meeting (all 3 signals):
    1. Microphone in use  - Windows records which app holds the mic.
    2. Meeting window     - Zoom / Teams / Meet window or browser tab is open.
    3. Pops Anchor        - opens Anchor (or brings it to the front) once per meeting.

  Test:   powershell -ExecutionPolicy Bypass -File AnchorWatcher.ps1 -Once -DryRun
#>
param(
    [string]$AnchorPath = "$env:LOCALAPPDATA\Programs\Anchor\Anchor.exe",
    [string]$AnchorProcessName = "Anchor",
    [int]$IntervalSeconds = 2,
    [switch]$Once,    # check one time, print the result, exit
    [switch]$DryRun   # detect and log only, don't open Anchor
)

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class AnchorWin {
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    public static List<KeyValuePair<uint, string>> Windows() {
        var list = new List<KeyValuePair<uint, string>>();
        EnumWindows((h, p) => {
            if (!IsWindowVisible(h)) return true;
            var sb = new StringBuilder(512);
            if (GetWindowText(h, sb, 512) > 0) {
                uint pid; GetWindowThreadProcessId(h, out pid);
                list.Add(new KeyValuePair<uint, string>(pid, sb.ToString()));
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@

$Browsers = 'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc'

function Get-AppKind([string]$name) {
    $n = $name.ToLower()
    if ($n -match 'zoom') { return 'Zoom' }
    if ($n -match 'teams') { return 'Teams' }
    foreach ($b in $Browsers) { if ($n -match "(^|\\)$b(\.exe)?$") { return 'Browser' } }
    return $null
}

# Signal 1: which apps are using the microphone right now
function Get-MicApps {
    $root = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
    if (-not (Test-Path $root)) { return @() }
    $keys = @(Get-ChildItem $root -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -ne 'NonPackaged' })
    $np = Join-Path $root 'NonPackaged'
    if (Test-Path $np) { $keys += @(Get-ChildItem $np -ErrorAction SilentlyContinue) }
    $kinds = @()
    foreach ($k in $keys) {
        $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
        if ($p -and $p.LastUsedTimeStart -and ($p.PSObject.Properties.Name -contains 'LastUsedTimeStop') -and $p.LastUsedTimeStop -eq 0) {
            $kind = Get-AppKind ($k.PSChildName -replace '#', '\')
            if ($kind) { $kinds += $kind }
        }
    }
    $kinds | Select-Object -Unique
}

# Signal 2: meeting windows / browser tabs that are open
function Get-MeetingWindows {
    $procs = @{}
    Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $procs[[uint32]$_.Id] = $_.ProcessName }
    $found = @()
    foreach ($w in [AnchorWin]::Windows()) {
        $name = $procs[$w.Key]; $title = $w.Value
        if (-not $name) { continue }
        switch (Get-AppKind $name) {
            'Zoom'    { if ($title -match 'Zoom Meeting|Zoom Webinar') { $found += 'Zoom' } }
            'Teams'   { if ($title -match '^(Meeting|Call)\b|Meeting in |Meet now|\(Meeting\)') { $found += 'Teams' } }
            'Browser' { if ($title -match 'Zoom Meeting|Zoom Webinar|zoom\.us|^Meet [-?]|Google Meet|Microsoft Teams') { $found += 'Browser' } }
        }
    }
    $found | Select-Object -Unique
}

function Test-InMeeting {
    $mic = @(Get-MicApps)
    $win = @(Get-MeetingWindows)
    # Desktop apps: mic OR meeting window. Browsers: mic AND a meeting tab (avoids non-meeting sites).
    $hit = @()
    if ($mic -contains 'Zoom' -or $win -contains 'Zoom') { $hit += 'Zoom' }
    if ($mic -contains 'Teams' -or $win -contains 'Teams') { $hit += 'Teams' }
    if ($mic -contains 'Browser' -and $win -contains 'Browser') { $hit += 'Browser meeting' }
    [pscustomobject]@{ InMeeting = ($hit.Count -gt 0); Source = ($hit -join ', '); Mic = ($mic -join ', '); Windows = ($win -join ', ') }
}

# Signal 3: pop Anchor
function Open-Anchor {
    $p = Get-Process -Name $AnchorProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($p) {
        [AnchorWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null   # 9 = restore
        [AnchorWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
        Log "Brought Anchor to front"
    } elseif ($AnchorPath -match '^[a-z][a-z0-9+.-]*://' -or (Test-Path $AnchorPath)) {
        Start-Process $AnchorPath
        Log "Opened Anchor"
    } else {
        Log "Anchor not found at '$AnchorPath' - set -AnchorPath"
    }
}

function Log([string]$msg) { Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $msg) }

if ($Once) {
    $s = Test-InMeeting
    Log ("In meeting: {0}  (source: {1})  mic: [{2}]  windows: [{3}]" -f $s.InMeeting, $s.Source, $s.Mic, $s.Windows)
    if ($s.InMeeting -and -not $DryRun) { Open-Anchor }
    return
}

Log "Watching for meetings..."
$wasInMeeting = $false
while ($true) {
    $s = Test-InMeeting
    if ($s.InMeeting -and -not $wasInMeeting) {
        Log "Meeting started ($($s.Source))"
        if (-not $DryRun) { Open-Anchor }
    } elseif (-not $s.InMeeting -and $wasInMeeting) {
        Log "Meeting ended"
    }
    $wasInMeeting = $s.InMeeting
    Start-Sleep -Seconds $IntervalSeconds
}
