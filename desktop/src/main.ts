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
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, session as electronSession } from "electron";
import * as path from "path";
import RecallAiSdk from "@recallai/desktop-sdk";
import { loadConfig, saveConfig, DEFAULT_API_BASE } from "./config";
import { AnchorApi } from "./anchorApi";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// The Granola-style floating panel — see showOverlay/hideOverlay below.
let overlayWindow: BrowserWindow | null = null;
// Closing the window (the red dot) hides it rather than quitting — see
// createWindow()'s "close" handler — so the app keeps detecting meetings
// in the background the way Granola/Zoom/Slack do. Only the tray menu's
// "Quit Anchor Desktop" (or Cmd+Q while the window has focus) actually
// exits, and sets this flag so the window's "close" handler knows to let
// it through instead of hiding it again.
let isQuitting = false;

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

// Starts recording a detected window — called automatically the instant
// meeting-detected fires (see initSdk below), and also reachable from the
// renderer's Record button as a manual fallback (e.g. if auto-start
// failed because no token was saved yet). Idempotent: if this window is
// already recording, just returns the existing meeting rather than
// starting a second one.
async function beginRecording(windowId: string, title: string): Promise<{ meetingId: string }> {
  const existing = activeRecordings.get(windowId);
  if (existing) return existing;

  const api = getApi();
  const { meeting, uploadToken } = await api.startMeeting(title);
  const active = { meetingId: meeting.id };
  // Recorded BEFORE calling startRecording (not after) so the
  // recording-started listener below — which the SDK can fire the
  // instant startRecording takes effect — is guaranteed to already find
  // this window's meetingId here and can show the overlay for it. This
  // ordering is the whole reason showOverlay works off activeRecordings
  // rather than a separate map.
  activeRecordings.set(windowId, active);
  await RecallAiSdk.startRecording({ windowId, uploadToken });
  return active;
}

// The overlay's own session/partition, separate from the main window's —
// so its cookies and this Authorization-header injection stay scoped to
// just this floating panel. onBeforeSendHeaders is registered once and
// re-reads the config fresh on every request (not just page load) so it
// covers both the initial navigation AND every fetch/XHR the loaded
// Focus window's own React code makes afterward (useLiveMeeting's poll,
// Ask Anchor, Customize) — none of that page's client-side fetches know
// to attach a header themselves, so this is what makes the desktop
// app's bearer token stand in for the browser session cookie those
// calls would normally send. Only attached for requests to the
// configured Anchor apiBase host — never leaked to any other origin the
// panel might somehow end up loading (fonts, etc).
let overlaySessionReady = false;
function overlaySession() {
  const ses = electronSession.fromPartition("persist:anchor-overlay");
  if (!overlaySessionReady) {
    overlaySessionReady = true;
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      try {
        const config = loadConfig();
        if (config.token) {
          const apiHost = new URL(config.apiBase || DEFAULT_API_BASE).host;
          const reqHost = new URL(details.url).host;
          if (reqHost === apiHost) {
            details.requestHeaders["Authorization"] = `Bearer ${config.token}`;
          }
        }
      } catch {
        // Malformed URL or similar — just pass the request through
        // unmodified rather than failing it.
      }
      callback({ requestHeaders: details.requestHeaders });
    });
  }
  return ses;
}

const OVERLAY_WIDTH = 420;
const OVERLAY_HEIGHT = 640;
const OVERLAY_MARGIN = 16;

// Auto-popup floating panel (Granola-style) — reuses the website's own
// Focus window (src/app/focus/[meetingId] in the main repo) instead of
// rebuilding its live-transcript/coaching UI natively, so it's always in
// sync with whatever that page shows in a browser tab. Positioned in the
// screen's top-right corner, frameless, always-on-top, and shown WITHOUT
// stealing focus from the actual meeting app (showInactive) — the point
// is a glanceable panel next to the call, not something that interrupts
// it.
function showOverlay(meetingId: string) {
  const config = loadConfig();
  if (!config.token) {
    log("Recording started but no Anchor token is saved yet — can't show the live coaching overlay.");
    return;
  }
  const apiBase = config.apiBase || DEFAULT_API_BASE;
  const url = `${apiBase}/focus/${meetingId}`;

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    const { workArea } = screen.getPrimaryDisplay();
    overlayWindow = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      x: Math.round(workArea.x + workArea.width - OVERLAY_WIDTH - OVERLAY_MARGIN),
      y: Math.round(workArea.y + OVERLAY_MARGIN),
      frame: false,
      alwaysOnTop: true,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        session: overlaySession(),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    overlayWindow.setAlwaysOnTop(true, "floating");
    // Keeps the panel visible even if the meeting app is fullscreen
    // (e.g. Zoom in fullscreen gallery view) — otherwise macOS would
    // treat the overlay as belonging to a different Space and hide it.
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.on("closed", () => {
      overlayWindow = null;
    });
  }

  overlayWindow.loadURL(url).catch((err) => {
    log(`Couldn't load the live coaching overlay: ${err instanceof Error ? err.message : err}`);
  });
  overlayWindow.showInactive();
}

function hideOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

async function initSdk() {
  // acquirePermissionsOnStartup does NOT actually trigger macOS's permission
  // prompts on its own (confirmed against docs.recall.ai/docs/macos-permissions
  // — the earlier assumption baked into this option was wrong, and it's why no
  // prompt was ever appearing). The real, documented way is to explicitly call
  // requestPermission() per permission after init(), which is what the loop
  // below does.
  await RecallAiSdk.init({ acquirePermissionsOnStartup: [] });

  // All event listeners are registered BEFORE the permission-request loop
  // below (this used to be the other way around) — requestPermission()
  // itself fires "permission-status" the moment each answer comes back,
  // and a listener attached only after the loop already finished misses
  // every one of those events. That gap was actively hiding the cause of
  // "nothing is being detected": the Activity log never showed whether a
  // permission had actually been granted or denied, only that the loop
  // ran without throwing (which it does either way — requestPermission
  // resolves either outcome without an exception).
  RecallAiSdk.addEventListener("meeting-detected", (evt) => {
    const title = evt.window.title || evt.window.platform || evt.window.id;
    log(`Meeting detected: ${title} — starting to record automatically`);
    send("meeting-detected", evt.window);
    // Auto-record on detection — no manual "Record" click needed, so
    // this only depends on the app already being open (which, once
    // installed, it always is — see the tray/launch-at-login setup
    // below) rather than on someone remembering to press a button.
    beginRecording(evt.window.id, title).catch((err) => {
      log(`Couldn't auto-start recording: ${err instanceof Error ? err.message : err}`);
    });
  });

  RecallAiSdk.addEventListener("meeting-closed", (evt) => {
    send("meeting-closed", evt.window);
  });

  RecallAiSdk.addEventListener("recording-started", (evt) => {
    log(`Recording started for window ${evt.window.id}`);
    send("recording-started", evt.window);
    const active = activeRecordings.get(evt.window.id);
    if (active) {
      showOverlay(active.meetingId);
    } else {
      // Shouldn't normally happen — beginRecording records this before
      // ever calling RecallAiSdk.startRecording (see its comment) — but
      // fall back quietly rather than throwing if it ever does.
      log("Recording started but no Anchor meeting is tracked for this window yet — overlay not shown.");
    }
  });

  RecallAiSdk.addEventListener("recording-ended", (evt) => {
    log(`Recording ended for window ${evt.window.id} — Recall is uploading it now`);
    activeRecordings.delete(evt.window.id);
    send("recording-ended", evt.window);
    // Simple for now: hides the overlay whenever ANY tracked recording
    // ends, which is correct for the common case (one call at a time).
    // If someone's ever recording two windows at once, the overlay would
    // hide when the first of the two ends even though the second is
    // still live — a known limitation, not worth the complexity of a
    // per-window overlay for how rare that case is.
    hideOverlay();
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

  if (process.platform === "darwin") {
    // macOS needs all four before it can detect windows, capture the
    // screen, capture the other participants' audio, and capture your own
    // mic, respectively. Requesting them here at startup rather than
    // lazily on first recording means the permission prompts happen once,
    // predictably, instead of interrupting someone mid-join. Windows needs
    // none of them (per docs.recall.ai/docs/desktop-sdk). Every outcome
    // now also lands in the Activity log via the permission-status
    // listener registered above — "granted" or "denied" per permission —
    // instead of only surfacing here if requestPermission itself throws
    // (it doesn't, for an ordinary denial; a denial is a normal resolved
    // status, not an exception).
    //
    // That logging is what caught a real build-config bug: accessibility
    // and screen-capture were both resolving "denied" in the same
    // instant as "SDK initialized" — no dialog, no wait, nothing for
    // anyone to click Allow on. That's the signature of Hardened Runtime
    // silently blocking these two prompts on an app with no real Apple
    // Developer ID signature (this app is ad-hoc/unsigned — no paid
    // account yet). Hardened Runtime only means anything once there's a
    // real certificate to notarize against; until then it's turned off
    // (see desktop/package.json's build.mac.hardenedRuntime) so macOS
    // actually shows these prompts instead of auto-denying them.
    for (const permission of ["accessibility", "screen-capture", "system-audio", "microphone"] as const) {
      try {
        await RecallAiSdk.requestPermission(permission);
      } catch (err) {
        log(`Couldn't request "${permission}" permission: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}

// The "super easy" connect flow: instead of a member copying a token off
// the website and pasting it into this app by hand, the website's
// "Connect Anchor Desktop" button mints a token the same way the manual
// flow always has (POST /api/profile/desktop-token) and then navigates
// the browser straight to anchor-desktop://connect?token=...&apiBase=...
// — macOS/Windows hand that URL to whichever app registered the
// "anchor-desktop" scheme (see setAsDefaultProtocolClient below), which
// is this app, so it arrives here as either an "open-url" event (macOS)
// or an argv entry on a second-instance launch / cold start (Windows —
// see the second-instance handler and the process.argv check in
// whenReady below). Same saveConfig call the manual "Save token" button
// already used; a member never has to see or copy the token itself.
function handleDeepLink(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    log(`Ignoring a link that isn't a valid URL: ${url}`);
    return;
  }
  if (parsed.protocol !== "anchor-desktop:") return;

  const token = parsed.searchParams.get("token");
  if (!token) {
    log("Opened an Anchor Desktop link, but it didn't include a token.");
    return;
  }
  const apiBase = parsed.searchParams.get("apiBase") || DEFAULT_API_BASE;
  saveConfig({ ...loadConfig(), apiBase, token });
  log("Connected to your Anchor account from the website.");
  send("token-connected", { apiBase });
  showWindow();
}

function registerIpcHandlers() {
  ipcMain.handle("get-config", () => {
    const config = loadConfig();
    return { apiBase: config.apiBase, hasToken: Boolean(config.token) };
  });

  ipcMain.handle("set-token", (_evt, token: string, apiBase?: string) => {
    saveConfig({ ...loadConfig(), apiBase: apiBase || DEFAULT_API_BASE, token });
    return { ok: true };
  });

  // Manual fallback — recording normally already started automatically
  // the moment the meeting was detected (see the meeting-detected
  // listener above); this only does anything if that failed (e.g. no
  // token was saved yet) or the window somehow isn't in
  // activeRecordings for another reason.
  ipcMain.handle("start-recording", async (_evt, windowId: string, title: string) => {
    const active = await beginRecording(windowId, title);
    return { id: active.meetingId };
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

  // Closing the window (the red dot) should not stop Anchor from watching
  // for meetings — that only happens if the person explicitly quits (tray
  // menu, or Cmd+Q). So intercept the close and hide instead, same as any
  // other always-on menu-bar app.
  mainWindow.on("close", (evt) => {
    if (isQuitting) return;
    evt.preventDefault();
    mainWindow?.hide();
  });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    mainWindow.show();
  }
  mainWindow?.focus();
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "src", "renderer", "icons", "trayTemplate.png");
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true); // lets macOS auto-tint it for light/dark menu bars
  tray = new Tray(icon);
  tray.setToolTip("Anchor Desktop — watching for Zoom, Teams, and Meet calls");
  refreshTrayMenu();
  tray.on("click", showWindow);
}

function refreshTrayMenu() {
  if (!tray) return;
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Anchor Desktop", click: showWindow },
      { type: "separator" },
      {
        label: "Launch at login",
        type: "checkbox",
        checked: openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked });
          saveConfig({ ...loadConfig(), launchAtLoginDefaultApplied: true });
        },
      },
      { type: "separator" },
      {
        label: "Quit Anchor Desktop",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
}

// Registers this app to handle anchor-desktop:// links — what makes the
// website's one-click "Connect Anchor Desktop" button (see
// handleDeepLink above) actually land here instead of the browser just
// showing an error. Safe/idempotent to call every launch; must be called
// unconditionally (not inside the single-instance-lock branch below) so
// even the instance that's about to quit still registers the app itself
// with the OS at least once.
app.setAsDefaultProtocolClient("anchor-desktop");

// macOS delivers a custom-protocol link via this event — including to an
// app that isn't running yet, in which case it can fire before
// whenReady, so this listener is registered immediately rather than
// nested inside app.whenReady().
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// A menu-bar app that's meant to always be running invites exactly the
// failure mode that turned up while diagnosing why nothing was
// auto-popping-up: launching it again (double-click, Spotlight, a
// reinstall's first open) while an old copy is still alive in the tray
// silently starts a SECOND process — a second Tray icon, a second
// RecallAiSdk.init(), a second everything, competing with the first in
// ways that can make meeting detection/recording/the overlay flaky or
// silent with no visible error. requestSingleInstanceLock stops that: if
// another copy is already running, THIS one quits immediately and instead
// asks the original (via "second-instance", below) to just bring its
// existing window forward.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    // Windows/Linux deliver a custom-protocol link by launching a second
    // instance with the URL as a command-line argument — which
    // requestSingleInstanceLock redirects here instead of letting a
    // second copy actually start. macOS never takes this path (it uses
    // "open-url" above instead), but this is harmless there too.
    const deepLink = commandLine.find((arg) => arg.startsWith("anchor-desktop://"));
    if (deepLink) handleDeepLink(deepLink);
    showWindow();
  });

  app.whenReady().then(async () => {
    registerIpcHandlers();
    createWindow();
    createTray();

    // Same Windows/Linux deep-link case as the second-instance handler
    // above, but for a COLD start — i.e. this app wasn't running yet
    // when the link was clicked, so there's no second instance to
    // redirect; the link instead shows up as this very first launch's
    // own argv.
    const coldStartDeepLink = process.argv.find((arg) => arg.startsWith("anchor-desktop://"));
    if (coldStartDeepLink) handleDeepLink(coldStartDeepLink);

    // Turn "launch at login" on by default the first time this app ever
    // runs on this machine, so installing it is the only setup step anyone
    // needs — exactly once; if someone later turns it off via the tray
    // menu, we remember that and don't force it back on.
    const config = loadConfig();
    if (!config.launchAtLoginDefaultApplied) {
      app.setLoginItemSettings({ openAtLogin: true });
      saveConfig({ ...config, launchAtLoginDefaultApplied: true });
      refreshTrayMenu();
    }

    try {
      await initSdk();
      log("Recall Desktop SDK initialized.");
    } catch (err) {
      log(`Failed to initialize the Recall Desktop SDK: ${err instanceof Error ? err.message : err}`);
    }
  });

  app.on("window-all-closed", () => {
    // Never quit on window close — see createWindow()'s "close" handler.
    // This listener now only matters on Windows/Linux where closing every
    // window used to end the app; the tray keeps it alive there too.
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("activate", () => {
    showWindow();
  });
}
