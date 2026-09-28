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

type ActiveRecording = { meetingId: string; dealId: string | null; title: string };

// windowId (Recall SDK's id for a detected meeting window) -> the
// Anchor meeting this recording became, once started. Lets the
// realtime-event and recording-ended handlers below know which Anchor
// meeting a given window's events belong to. dealId is whatever
// matchDealNow() found at start time (see beginRecordingUnguarded) —
// null when this call couldn't be matched to a deal, in which case the
// renderer shows a "not linked to a deal yet" placeholder instead of the
// Ask Anchor / live suggestions / to-do panels, which are all deal-scoped.
const activeRecordings = new Map<string, ActiveRecording>();

// windowIds that are ACTUALLY recording right now — a plain Set, kept in
// lockstep with recording-started/recording-ended (added/removed
// immediately, unlike activeRecordings above, which keeps an ended
// window's entry around for a 5s grace period for trailing transcript
// lines). Exists so the overlay only hides when NO recording is still
// live — see the recording-ended listener below. Someone recording two
// meeting windows at once is rare, but not impossible (a demo call
// itself running in Zoom/Meet while a second window is also open,
// investors screen-sharing their own call, etc.) — this listener used to
// hide the coaching overlay the instant ANY tracked recording ended, even
// with a second one still genuinely live, which is exactly the kind of
// thing to not discover for the first time live in front of investors.
const recordingWindowIds = new Set<string>();

function send(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload);
}

function log(message: string) {
  console.log(`[anchor-desktop] ${message}`);
  send("log", message);
}

// Allow-list for handleDeepLink's apiBase — see the comment there. The
// production host plus localhost/127.0.0.1 (any port) for local dev
// against `npm run dev`. Everything else is rejected.
function isAllowedApiBase(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.origin === DEFAULT_API_BASE) return true;
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return true;
  return false;
}

function getApi(): AnchorApi {
  const config = loadConfig();
  if (!config.token) {
    throw new Error("No Anchor desktop token saved yet — paste one in from the Integrations page first.");
  }
  return new AnchorApi(config.apiBase || DEFAULT_API_BASE, config.token);
}

// windowId -> the in-flight beginRecording() promise for that window, if
// one is currently running. Closes a race the `existing` check below
// can't catch on its own: activeRecordings isn't populated until AFTER
// two network round-trips (matchDealNow, startMeeting), so the automatic
// meeting-detected call and a manual Record-button click landing in that
// gap would both see nothing in activeRecordings and both proceed,
// creating two meetings and two RecallAiSdk.startRecording calls for the
// same window. Setting this synchronously, before any await, closes that
// window; it's cleared in a `finally` once the call settles either way.
const startsInFlight = new Map<string, Promise<ActiveRecording>>();

// Starts recording a detected window — called automatically the instant
// meeting-detected fires (see initSdk below), and also reachable from the
// renderer's Record button as a manual fallback (e.g. if auto-start
// failed because no token was saved yet). Idempotent: if this window is
// already recording, just returns the existing meeting rather than
// starting a second one.
async function beginRecording(windowId: string, title: string): Promise<ActiveRecording> {
  const existing = activeRecordings.get(windowId);
  if (existing) return existing;

  const inFlight = startsInFlight.get(windowId);
  if (inFlight) return inFlight;

  const promise = beginRecordingUnguarded(windowId, title).finally(() => {
    startsInFlight.delete(windowId);
  });
  startsInFlight.set(windowId, promise);
  return promise;
}

async function beginRecordingUnguarded(windowId: string, title: string): Promise<ActiveRecording> {
  const api = getApi();
  // Best-effort: figure out which deal this call is for before creating
  // the meeting, so it lands there automatically instead of coming
  // through unassigned — see AnchorApi.matchDealNow(). Never blocks or
  // fails the recording if this comes back empty.
  const dealMatch = await api.matchDealNow().catch(() => undefined);
  if (dealMatch) {
    log(`Matched this call to "${dealMatch.dealName}" — recording will be added there automatically.`);
  }
  const { meeting, uploadToken } = await api.startMeeting(title, dealMatch?.dealId);
  const active = { meetingId: meeting.id, dealId: dealMatch?.dealId ?? null, title };
  // Recorded BEFORE calling startRecording (not after) so the
  // recording-started listener below — which the SDK can fire the
  // instant startRecording takes effect — is guaranteed to already find
  // this window's meetingId here and can show the overlay for it. This
  // ordering is the whole reason showOverlay works off activeRecordings
  // rather than a separate map.
  activeRecordings.set(windowId, active);
  try {
    await RecallAiSdk.startRecording({ windowId, uploadToken });
  } catch (err) {
    // startMeeting already created this meeting "live" on Anchor's
    // backend before we knew whether the local SDK would actually accept
    // it — if it didn't, undo both sides: drop it from activeRecordings
    // (so a retry isn't short-circuited by the "existing" check above)
    // and tell Anchor to mark it failed (so it doesn't stay stuck
    // "recording" forever and block every future call for this deal via
    // the one-live-capture guard — this is what caused that exact stuck
    // state the first time this shipped).
    activeRecordings.delete(windowId);
    await api.stopMeeting(meeting.id, { failed: true }).catch((cleanupErr) => {
      log(
        `Also couldn't mark the failed meeting as failed on Anchor's side: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`
      );
    });
    throw err;
  }
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

  log(`Showing live coaching overlay for meeting ${meetingId} (${url})`);
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

// Pushes live coaching (nudges, checklist, the one question that looks
// unanswered) into the main window's own UI, not just the floating
// overlay — the overlay shows the website's Focus page, but the main
// window's Ask Anchor / suggestions / to-do panels are native to this
// app, so they need their own feed. Mirrors the server's own ~8s
// debounce (see AnchorApi.getLiveSuggestions) rather than polling
// faster, since a shorter interval here would just re-fetch the same
// cached answer. A no-op whenever nothing is actually recording.
const LIVE_SUGGESTIONS_POLL_MS = 8000;
function startLiveSuggestionsPolling() {
  setInterval(() => {
    if (recordingWindowIds.size === 0) return;
    let api: AnchorApi;
    try {
      api = getApi();
    } catch {
      return; // No token saved yet — nothing to poll with.
    }
    for (const windowId of recordingWindowIds) {
      const active = activeRecordings.get(windowId);
      if (!active) continue;
      api
        .getLiveSuggestions(active.meetingId)
        .then((suggestions) => {
          send("live-suggestions-updated", { windowId, meetingId: active.meetingId, suggestions });
        })
        .catch(() => {
          // getLiveSuggestions already swallows its own errors and
          // resolves null — this catch is just defensive.
        });
    }
  }, LIVE_SUGGESTIONS_POLL_MS);
}

// Recall.ai's API is region-scoped — see
// src/app/api/desktop/recall-region/route.ts for the full explanation.
// Without this, RecallAiSdk.init() defaults to a host that may not match
// the region our backend created the upload token against, and every
// recording fails with "Invalid upload token" even though the token
// itself is perfectly valid. Best-effort with a short timeout: if this
// can't be reached (offline, slow network), initSdk() proceeds without an
// override rather than blocking startup — recordings just fall back to
// whatever the SDK's own default region-guessing does in that case.
async function fetchRecallApiUrl(): Promise<string | undefined> {
  const config = loadConfig();
  const apiBase = config.apiBase || DEFAULT_API_BASE;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${apiBase}/api/desktop/recall-region`, { signal: controller.signal });
    if (!res.ok) return undefined;
    const body = await res.json().catch(() => ({}));
    return typeof body.apiUrl === "string" && body.apiUrl ? body.apiUrl : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function initSdk() {
  // acquirePermissionsOnStartup does NOT actually trigger macOS's permission
  // prompts on its own (confirmed against docs.recall.ai/docs/macos-permissions
  // — the earlier assumption baked into this option was wrong, and it's why no
  // prompt was ever appearing). The real, documented way is to explicitly call
  // requestPermission() per permission after init(), which is what the loop
  // below does.
  const recallApiUrl = await fetchRecallApiUrl();
  if (recallApiUrl) {
    log(`Using Recall.ai region endpoint: ${recallApiUrl}`);
  } else {
    log("Couldn't fetch Anchor's Recall.ai region — falling back to the SDK's default, which may cause 'Invalid upload token' errors if it doesn't match Anchor's account region.");
  }
  await RecallAiSdk.init({ apiUrl: recallApiUrl, acquirePermissionsOnStartup: [] });

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
    log(`Recording started for window ${evt.window.id} (rawMedia: ${evt.rawMedia})`);
    if (!evt.rawMedia) {
      // Per the SDK's own docs, rawMedia is "the source of truth for the
      // active recording; false includes recordings that fell back to
      // local capture" — previously never read anywhere in this file, so
      // this distinction was silently discarded even though it's exactly
      // the kind of signal worth having on hand while transcript.data's
      // real shape off a desktop recording is still unconfirmed (see the
      // realtime-event listener below): if live transcript delivery ever
      // behaves differently, whether this call used Raw Media or fell
      // back to local capture is one of the first things worth checking.
      log(`Window ${evt.window.id} fell back to local capture (rawMedia: false) instead of Desktop SDK Raw Media.`);
    }
    recordingWindowIds.add(evt.window.id);
    const active = activeRecordings.get(evt.window.id);
    // Carries meetingId/dealId alongside the window info (evt.window
    // itself is unchanged) so the renderer's Ask Anchor / live
    // suggestions / to-do panels — all deal-scoped — know which deal
    // this recording is for, without a separate round-trip.
    send("recording-started", { ...evt.window, meetingId: active?.meetingId ?? null, dealId: active?.dealId ?? null });
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
    // Deletes from activeRecordings after a short grace period rather
    // than immediately — a transcript.data event for the last few
    // finalized words of the call can still arrive after recording-ended
    // fires, and the realtime-event handler below drops anything for a
    // window it can't find in activeRecordings. This just gives those
    // trailing lines a few seconds to land before the window stops being
    // tracked; the final audio/transcript pipeline (via the completed-
    // recording webhook) isn't affected either way.
    const windowId = evt.window.id;
    const endedRecording = activeRecordings.get(windowId);
    setTimeout(() => {
      // Only delete if this window's entry is still the SAME recording
      // that just ended — guards against a quick re-record of the same
      // window (a new beginRecording within this grace window) having
      // its fresh entry wiped out by this stale timer.
      if (activeRecordings.get(windowId) === endedRecording) {
        activeRecordings.delete(windowId);
      }
    }, 5000);
    send("recording-ended", evt.window);
    recordingWindowIds.delete(windowId);
    if (recordingWindowIds.size === 0) {
      hideOverlay();
    } else {
      // At least one other window is still genuinely recording — keep
      // the overlay up rather than hiding it out from under a call
      // that's still going, and re-point it at that other meeting (it
      // may currently still show whatever meeting just ended). Only one
      // overlay window exists, so with two calls truly simultaneous this
      // still only ever shows one at a time — a known, accepted
      // limitation, just no longer one that hides coaching entirely
      // while a call is still live.
      const otherWindowId = recordingWindowIds.values().next().value;
      const other = otherWindowId ? activeRecordings.get(otherWindowId) : undefined;
      if (other) {
        showOverlay(other.meetingId);
      }
    }
  });

  // Real-time transcript events during the call — turned on by
  // src/lib/recall.ts::createSdkUpload in the main repo (recallai_streaming
  // + a "desktop_sdk_callback" realtime_endpoint), which is what makes
  // Recall deliver transcript.data here instead of (or in addition to) a
  // webhook. Recall's own docs
  // (https://docs.recall.ai/docs/real-time-event-payloads) confirm the
  // word-level fields (words[].text, participant.name,
  // words[0].start_timestamp.relative) — that part mirrors what
  // src/app/api/webhooks/recall/transcript/route.ts already parses for
  // bot calls, since it's the same underlying provider. What the docs
  // DON'T confirm is how many levels deep that object sits inside
  // evt.data for THIS delivery mechanism specifically: the example
  // payload they show nests it two levels ({data: {data: {words...}}}),
  // matching the webhook route's payload.data.data, but it's undocumented
  // whether the SDK's desktop_sdk_callback delivery hands this listener
  // that same outer envelope (2 levels) or already unwraps it (1 level,
  // this file's original assumption) — see the shape-detection below,
  // which now handles both instead of assuming one. Still not yet seen
  // for real off a desktop recording, so this stays defensive (bails
  // quietly, with a log line, on anything neither shape matches) and
  // logs the raw event too, in case the real shape turns out to be
  // neither.
  //
  // DIAGNOSTIC LOGGING: the Activity panel gets one compact line per
  // transcript.data event confirming which payload shape matched — full
  // raw JSON is only dumped when NEITHER shape matches, since that's the
  // one case with an actual problem to diagnose. (Earlier this dumped the
  // full raw payload on every single event, unconditionally — useful for
  // the first live test but noisy for anyone glancing at Activity during
  // an ordinary call once the shape is confirmed working.)
  RecallAiSdk.addEventListener("realtime-event", (evt) => {
    const active = activeRecordings.get(evt.window.id);
    if (evt.event !== "transcript.data") {
      // Anything else (participant events, other providers' formats,
      // etc.) — just logged, not forwarded anywhere yet.
      log(`Realtime event "${evt.event}" for window ${evt.window.id}${active ? ` (meeting ${active.meetingId})` : ""}`);
      return;
    }

    // ROOT-CAUSE FINDING: Recall's own docs
    // (https://docs.recall.ai/docs/real-time-event-payloads) show
    // transcript.data's JSON with the words array nested TWO levels
    // deep — {"data": {"data": {"words": [...]}}} — matching exactly
    // what src/app/api/webhooks/recall/transcript/route.ts already
    // parses for a bot call's webhook delivery (payload.data.data). This
    // file, however, has always assumed ONE level (evt.data.words
    // directly) for the desktop SDK's desktop_sdk_callback delivery —
    // and Recall's docs don't say whether the SDK hands over that same
    // outer envelope as evt.data (2 levels) or already unwraps it before
    // calling this listener (1 level, the original assumption). Rather
    // than guess and risk silently dropping every real transcript line,
    // check both shapes and use whichever one actually has a words
    // array — correct either way, and the shape actually found is
    // logged so a real test confirms it for good instead of leaving it
    // to keep being an assumption.
    type TranscriptPayload = {
      words?: { text?: string; start_timestamp?: { relative?: number } }[];
      participant?: { name?: string | null };
    };
    const rawData = evt.data as (TranscriptPayload & { data?: TranscriptPayload }) | undefined;
    let data: TranscriptPayload | undefined;
    let shape: "direct" | "nested" | "unrecognized";
    if (rawData && Array.isArray(rawData.words)) {
      data = rawData;
      shape = "direct";
    } else if (rawData?.data && Array.isArray(rawData.data.words)) {
      data = rawData.data;
      shape = "nested";
    } else {
      data = undefined;
      shape = "unrecognized";
    }

    if (shape === "unrecognized") {
      let rawJson = "";
      try {
        rawJson = JSON.stringify(evt.data);
      } catch {
        rawJson = String(evt.data);
      }
      log(`transcript.data payload shape: unrecognized — raw payload: ${rawJson.slice(0, 500)}${rawJson.length > 500 ? "…" : ""}`);
    } else {
      log(`transcript.data payload shape: ${shape}`);
    }

    if (!active) {
      log(`(no active recording tracked for window ${evt.window.id} — dropping this transcript line)`);
      return;
    }

    const text = (data?.words || [])
      .map((w) => w.text || "")
      .join(" ")
      .trim();
    if (!text) {
      log(
        `Couldn't extract text from transcript.data payload (shape: ${shape}, but its words array was empty or missing text).`
      );
      return;
    }

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

  // Two more real, documented SDK events — confirmed against the
  // installed package's own index.d.ts — that weren't wired up anywhere
  // in this file before now. Added as root-cause diagnostic instrumentation
  // alongside the transcript.data raw-payload logging above: if a live
  // recording ever shows no transcript (or a shape this file doesn't
  // parse), these are the next places to look for WHY, one level below
  // Anchor's own event handling, in the native SDK process itself.
  RecallAiSdk.addEventListener("network-status", (evt) => {
    log(`Network ${evt.status}`);
    send("network-status", evt);
  });

  RecallAiSdk.addEventListener("log", (evt) => {
    // 'debug'/'info' come from the native SDK process and can fire far
    // more often than anything else this file logs — filtered out so
    // they don't drown the Activity panel; 'warning'/'error' are exactly
    // the kind of native-level signal worth surfacing.
    if (evt.level !== "warning" && evt.level !== "error") return;
    log(
      `SDK ${evt.level} [${evt.subsystem}/${evt.category}]${evt.window_id ? ` (window ${evt.window_id})` : ""}: ${evt.message}`
    );
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
  // anchor-desktop:// is registered as a SYSTEM-WIDE protocol handler
  // (see setAsDefaultProtocolClient below) — any link with this scheme,
  // from any source (not just Anchor's own "Connect" button), reaches
  // this function. Without validating apiBase against a known host, a
  // malicious "anchor-desktop://connect?token=x&apiBase=evil.example"
  // link would silently repoint every future request this app makes —
  // meeting start, deal matching, live-transcript push, and the overlay
  // window's own page load — at an attacker's server. Only accept the
  // real Anchor host or a local dev server; anything else falls back to
  // DEFAULT_API_BASE instead of being trusted.
  const requestedApiBase = parsed.searchParams.get("apiBase");
  const apiBase = requestedApiBase && isAllowedApiBase(requestedApiBase) ? requestedApiBase : DEFAULT_API_BASE;
  if (requestedApiBase && requestedApiBase !== apiBase) {
    log(`Ignoring untrusted apiBase in connect link ("${requestedApiBase}") — using the default Anchor server instead.`);
  }
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
    return { id: active.meetingId, dealId: active.dealId };
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

  // The three deal-scoped panels the main window shows alongside a
  // live (or just-finished) recording — see desktop/src/anchorApi.ts for
  // what each of these actually calls on Anchor's backend. All three are
  // no-ops the renderer shouldn't even offer when a recording's dealId
  // is null (not every call gets auto-matched to a deal — see
  // matchDealNow), but they're still guarded here too in case that ever
  // changes.
  ipcMain.handle("ask-anchor", async (_evt, dealId: string, question: string) => {
    const api = getApi();
    // Streamed chunks (the answer-so-far, same as the web app's own Ask
    // Anchor panel) go out as they arrive; the final chunk is also the
    // resolved return value, so a renderer that only cares about the
    // finished answer can just await the invoke call instead of also
    // listening for the chunk event.
    const answer = await api.askAnchor(dealId, question, (soFar) => {
      send("ask-anchor-chunk", soFar);
    });
    return { answer };
  });

  ipcMain.handle("get-deal-tasks", async (_evt, dealId: string) => {
    const api = getApi();
    const tasks = await api.getDealTasks(dealId);
    return { tasks };
  });

  ipcMain.handle("toggle-task", async (_evt, taskId: string, completed: boolean) => {
    const api = getApi();
    const task = await api.toggleTask(taskId, completed);
    return { task };
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

    startLiveSuggestionsPolling();

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
