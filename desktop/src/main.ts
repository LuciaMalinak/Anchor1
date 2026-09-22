// Anchor Desktop — Electron main process.
//
// Detects a Zoom/Teams/Meet window, records it locally with no bot ever
// joining the call, and streams both the finished recording and a
// real-time transcript back to Anchor — the finished recording through
// Anchor's existing transcribe -> summarize -> ready pipeline (same as
// any other meeting, via Recall's webhook once it's done uploading), and
// the real-time transcript live, utterance by utterance, into the same
// meeting_live_segment feed a Zoom bot call already writes to — see the
// "realtime-event" listener below and src/lib/recall.ts::createSdkUpload
// in the main repo for how that stream gets turned on. That's what
// drives the During tab's live panel, the Focus window, and live
// coaching for a desktop recording the same way it already works for a
// bot-joined call. A real installer (packaging/signing) is a separate,
// later phase — see desktop/README.md.
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
  // acquirePermissionsOnStartup does NOT actually trigger macOS's permission
  // prompts on its own (confirmed against docs.recall.ai/docs/macos-permissions
  // — the earlier assumption baked into this option was wrong, and it's why no
  // prompt was ever appearing). The real, documented way is to explicitly call
  // requestPermission() per permission after init(), which is what the loop
  // below does.
  await RecallAiSdk.init({ acquirePermissionsOnStartup: [] });

  if (process.platform === "darwin") {
    // macOS needs all four before it can detect windows, capture the
    // screen, capture the other participants' audio, and capture your own
    // mic, respectively. Requesting them here at startup rather than
    // lazily on first recording means the permission prompts happen once,
    // predictably, instead of interrupting someone mid-join. Windows needs
    // none of them (per docs.recall.ai/docs/desktop-sdk).
    for (const permission of ["accessibility", "screen-capture", "system-audio", "microphone"] as const) {
      try {
        await RecallAiSdk.requestPermission(permission);
      } catch (err) {
        log(`Couldn't request "${permission}" permission: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

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

  // Real-time transcript events during the call — turned on by
  // src/lib/recall.ts::createSdkUpload in the main repo (recallai_streaming
  // + a "desktop_sdk_callback" realtime_endpoint), which is what makes
  // Recall deliver transcript.data here instead of (or in addition to) a
  // webhook. The nested shape (words[].text, participant.name,
  // words[0].start_timestamp.relative) mirrors what
  // src/app/api/webhooks/recall/transcript/route.ts already parses for
  // bot calls, since it's the same underlying provider — not yet seen
  // for real off a desktop recording, so this stays defensive (bails
  // quietly on anything unexpected) and logs the raw event too, in case
  // the shape turns out to differ once tested for real.
  RecallAiSdk.addEventListener("realtime-event", (evt) => {
    const active = activeRecordings.get(evt.window.id);
    if (evt.event !== "transcript.data") {
      // Anything else (participant events, other providers' formats,
      // etc.) — just logged, not forwarded anywhere yet.
      log(`Realtime event "${evt.event}" for window ${evt.window.id}${active ? ` (meeting ${active.meetingId})` : ""}`);
      return;
    }
    if (!active) return;

    const data = evt.data as
      | {
          words?: { text?: string; start_timestamp?: { relative?: number } }[];
          participant?: { name?: string | null };
        }
      | undefined;
    const text = (data?.words || [])
      .map((w) => w.text || "")
      .join(" ")
      .trim();
    if (!text) return;

    const relativeSeconds = data?.words?.[0]?.start_timestamp?.relative;
    try {
      getApi()
        .pushLiveTranscript(
          active.meetingId,
          text,
          data?.participant?.name ?? null,
          typeof relativeSeconds === "number" ? Math.round(relativeSeconds) : null
        )
        .catch((err) => log(`Couldn't push live transcript line: ${err instanceof Error ? err.message : err}`));
    } catch (err) {
      log(`Couldn't push live transcript line: ${err instanceof Error ? err.message : err}`);
    }
  });

  RecallAiSdk.addEventListener("permission-status", (evt) => {
    log(`Permission "${evt.permission}": ${evt.status}`);
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
