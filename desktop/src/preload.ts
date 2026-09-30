// Bridges the sandboxed renderer (desktop/src/renderer/) to the main
// process's IPC handlers (main.ts) — the renderer never talks to
// Electron/Node/Recall APIs directly, only through this narrow surface.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("anchor", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  setToken: (token: string, apiBase?: string) => ipcRenderer.invoke("set-token", token, apiBase),
  startSignIn: () => ipcRenderer.invoke("start-sign-in"),
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
  onTokenConnected: (cb: (payload: { apiBase: string; accountEmail?: string }) => void) =>
    ipcRenderer.on("token-connected", (_evt, payload) => cb(payload)),

  // Ask Anchor / live suggestions / to-do — the same deal-scoped panels
  // the web app's During tab and Focus window show, now native to this
  // window too (see main.ts's registerIpcHandlers and
  // startLiveSuggestionsPolling). All three are no-ops for a recording
  // whose dealId is null — the renderer shows a placeholder instead of
  // calling any of these.
  askAnchor: (dealId: string, question: string) => ipcRenderer.invoke("ask-anchor", dealId, question),
  getDealTasks: (dealId: string) => ipcRenderer.invoke("get-deal-tasks", dealId),
  toggleTask: (taskId: string, completed: boolean) => ipcRenderer.invoke("toggle-task", taskId, completed),
  onAskAnchorChunk: (cb: (soFar: string) => void) =>
    ipcRenderer.on("ask-anchor-chunk", (_evt, soFar) => cb(soFar)),
  onLiveSuggestionsUpdated: (cb: (payload: unknown) => void) =>
    ipcRenderer.on("live-suggestions-updated", (_evt, payload) => cb(payload)),
});
