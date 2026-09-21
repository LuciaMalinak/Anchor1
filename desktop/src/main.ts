// Anchor Desktop — Electron main process.
//
// Phase 1 goal (per the plan already agreed with Lucia): scaffold this
// app, wire up Recall.ai's Desktop Recording SDK, detect a Zoom/Teams/
// Meet window, record it locally with no bot ever joining the call, and
// prove the recording makes it all the way through Anchor's existing
// transcribe -> summarize -> ready pipeline. Live coaching / Ask Anchor
// during the call (Phase 2) and packaging/signing for distribution
// (Phase 4) come later.
//
// IMPORTANT: @recallai/desktop-sdk's postinstall step downloads real
// platform-specific native binaries (see its setup.js) — `npm install`
// here has to run on the actual target machine (an Apple Silicon Mac or
// Windows; Intel Macs aren't supported per Recall's docs), not in a
// Linux dev sandbox. See desktop/README.md.
import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import RecallAiSdk from "@recallai/desktop-sdk";
import { loadConfig, saveConfig, DEFAULT_API_BASE } from "./config";
import { AnchorApi } from "./anchorApi";

let mainWindow: BrowserWindow | null = null;

// windowId (Recall SDK's id for a detected meeting window) -> the
// Anchor meeting this recording became, once started. Lets the
// realtime-event and recording-ended handlers below know which Anchor
// meeting a given window's events belong to.
const activeRecordings = new Map<string, { meetingId: string }>();

function send(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload);
}

function log(message: string) {
  console.log(`[anchor-desktop] ${message}`);
  send("log", message);
}

function getApi(): AnchorApi {
  const config = loadConfig();
  if (!config.token) {
    throw new Error("No Anchor desktop token saved yet — paste one in from the Integrations page first.");
  }
  return new AnchorApi(config.apiBase || DEFAULT_API_BASE, config.token);
}

async function initSdk() {
  await RecallAiSdk.init({
    // macOS needs these three granted before it can capture anything;
    // Windows needs none of them (per docs.recall.ai/docs/desktop-sdk).
    // Requesting them here at startup rather than lazily on first
    // recording means the permission prompts happen once, predictably,
    // instead of interrupting someone mid-join.
    acquirePermissionsOnStartup:
      process.platform === "darwin" ? ["accessibility", "screen-capture", "microphone"] : [],
  });

  RecallAiSdk.addEventListener("meeting-detected", (evt) => {
    log(`Meeting detected: ${evt.window.title ?? evt.window.platform ?? evt.window.id}`);
    send("meeting-detected", evt.window);
  });

  RecallAiSdk.addEventListener("meeting-closed", (evt) => {
    send("meeting-closed", evt.window);
  });

  RecallAiSdk.addEventListener("recording-started", (evt) => {
    log(`Recording started for window ${evt.window.id}`);
    send("recording-started", evt.window);
  });

  RecallAiSdk.addEventListener("recording-ended", (evt) => {
    log(`Recording ended for window ${evt.window.id} — Recall is uploading it now`);
    activeRecordings.delete(evt.window.id);
    send("recording-ended", evt.window);
  });

  // Real-time transcript / other events during the call. Recall's exact
  // desktop-SDK realtime-transcript event shape isn't independently
  // confirmed in this codebase yet (see the note in
  // src/lib/recall.ts::createSdkUpload in the main repo for the same
  // caveat on the webhook side) — logged in full for now rather than
  // guessed at, so Phase 2 (live transcript/coaching) can be wired up
  // against the real payload once one's been seen.
  RecallAiSdk.addEventListener("realtime-event", (evt) => {
    const active = activeRecordings.get(evt.window.id);
    log(`Realtime event "${evt.event}" for window ${evt.window.id}${active ? ` (meeting ${active.meetingId})` : ""}`);
    send("realtime-event", evt);
  });

  RecallAiSdk.addEventListener("permission-status", (evt) => {
    send("permission-status", evt);
  });

  RecallAiSdk.addEventListener("error", (evt) => {
    log(`SDK error (${evt.type}): ${evt.message}`);
    send("sdk-error", evt);
  });

  RecallAiSdk.addEventListener("shutdown", (evt) => {
    log(`SDK shut down (code ${evt.code})`);
  });
}

function registerIpcHandlers() {
  ipcMain.handle("get-config", () => {
    const config = loadConfig();
    return { apiBase: config.apiBase, hasToken: Boolean(config.token) };
  });

  ipcMain.handle("set-token", (_evt, token: string, apiBase?: string) => {
    saveConfig({ apiBase: apiBase || DEFAULT_API_BASE, token });
    return { ok: true };
  });

  ipcMain.handle("start-recording", async (_evt, windowId: string, title: string) => {
    const api = getApi();
    const { meeting, uploadToken } = await api.startMeeting(title);
    await RecallAiSdk.startRecording({ windowId, uploadToken });
    activeRecordings.set(windowId, { meetingId: meeting.id });
    return meeting;
  });

  ipcMain.handle("stop-recording", async (_evt, windowId: string) => {
    const active = activeRecordings.get(windowId);
    await RecallAiSdk.stopRecording({ windowId });
    if (active) {
      const api = getApi();
      await api.stopMeeting(active.meetingId).catch((err) => {
        // Local recording already stopped regardless — surfacing this
        // as a log line rather than throwing, since the audio will
        // still reach Anchor via Recall's webhook once it finishes
        // uploading even if this particular confirmation call failed.
        log(`Couldn't confirm stop with Anchor: ${err instanceof Error ? err.message : err}`);
      });
    }
    return { ok: true };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"));
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  createWindow();
  try {
    await initSdk();
    log("Recall Desktop SDK initialized.");
  } catch (err) {
    log(`Failed to initialize the Recall Desktop SDK: ${err instanceof Error ? err.message : err}`);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
