; Uninstalling also removes the scheduled task that starts Anchor again
; when it isn't running (see installWindowsWatchdog in src/backgroundAgent.ts),
; so it doesn't keep trying to start an app that's gone. An update runs
; this too; the new version puts the task back as soon as it starts.
!macro customUnInstall
  nsExec::Exec 'schtasks /Delete /F /TN "Anchor Desktop - keep watching for calls"'
!macroend
