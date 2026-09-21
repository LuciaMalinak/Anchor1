// Bridges the sandboxed renderer (desktop/src/renderer/) to the main
// process's IPC handlers (main.ts) — the renderer never talks to
// Electron/Node/Recall APIs directly, only through this narrow surface.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("anchor", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  setToken: (token: string, apiBase?: string) => ipcRenderer.invoke("set-token", token, apiBase),
  startRecording: (windowId: string, title: string) => ipcRenderer.invoke("start-recording", windowId, title),
  stopRecording: (windowId: string) => ipcRenderer.invoke("stop-recording", windowId),

  onMeetingDetected: (cb: (window: unknown) => void) =>
    ipcRenderer.on("meeting-detected", (_evt, window) => cb(window)),
  onMeetingClosed: (cb: (window: unknown) => void) =>
    ipcRenderer.on("meeting-closed", (_evt, window) => cb(window)),
  onRecordingStarted: (cb: (window: unknown) => void) =>
    ipcRenderer.on("recording-started", (_evt, window) => cb(window)),
  onRecordingEnded: (cb: (window: unknown) => void) =>
    ipcRenderer.on("recording-ended", (_evt, window) => cb(window)),
  onLog: (cb: (message: string) => void) => ipcRenderer.on("log", (_evt, message) => cb(message)),
  onSdkError: (cb: (evt: unknown) => void) => ipcRenderer.on("sdk-error", (_evt, evt) => cb(evt)),
});
