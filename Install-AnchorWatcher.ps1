<#
  One-time install on a client PC. After this, Anchor opens by itself whenever a meeting starts,
  and the watcher starts automatically every time the client signs in to Windows.

  Install:    powershell -ExecutionPolicy Bypass -File Install-AnchorWatcher.ps1 -AnchorPath "C:\path\to\Anchor.exe"
  Uninstall:  powershell -ExecutionPolicy Bypass -File Install-AnchorWatcher.ps1 -Uninstall
#>
param(
    [string]$AnchorPath = "$env:LOCALAPPDATA\Programs\Anchor\Anchor.exe",
    [switch]$Uninstall
)

$dir      = Join-Path $env:LOCALAPPDATA 'AnchorWatcher'
$script   = Join-Path $dir 'AnchorWatcher.ps1'
$shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Anchor Meeting Watcher.lnk'

# Stop any watcher already running
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*AnchorWatcher.ps1*' -and $_.ProcessId -ne $PID } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if ($Uninstall) {
    Remove-Item $shortcut -ErrorAction SilentlyContinue
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Anchor Meeting Watcher removed."
    return
}

New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'AnchorWatcher.ps1') $script -Force

$runArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -AnchorPath `"$AnchorPath`""
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
$lnk.TargetPath  = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments   = $runArgs
$lnk.WindowStyle = 7   # minimized
$lnk.Save()

Start-Process -FilePath $lnk.TargetPath -ArgumentList $runArgs -WindowStyle Hidden
Write-Host "Installed. Anchor will open automatically when a Zoom, Teams or Meet meeting starts."

