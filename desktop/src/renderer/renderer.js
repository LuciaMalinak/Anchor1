// Plain-JS renderer (not TypeScript — this runs directly in Electron's
// Chromium renderer process, unbuilt) for the Anchor Desktop Phase-1
// scaffold. Talks only to window.anchor, the narrow bridge preload.ts
// exposes — never Node/Electron APIs directly.

const statusEl = document.getElementById("status");
const tokenInput = document.getElementById("token-input");
const saveTokenBtn = document.getElementById("save-token");
const meetingsEl = document.getElementById("meetings");
const logEl = document.getElementById("log");

// windowId -> { title, recording, meetingId }
const meetings = new Map();

function appendLog(message) {
  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function renderMeetings() {
  if (meetings.size === 0) {
    meetingsEl.innerHTML = '<p style="font-size:12px;color:#94a3b8">Open a Zoom, Teams, or Meet call — it\'ll show up here.</p>';
    return;
  }
  meetingsEl.innerHTML = "";
  for (const [windowId, m] of meetings) {
    const row = document.createElement("div");
    row.className = "meeting";
    const label = document.createElement("span");
    label.textContent = m.title || windowId;
    const btn = document.createElement("button");
    btn.textContent = m.recording ? "Stop" : "Record";
    btn.className = m.recording ? "stop" : "";
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (m.recording) {
          await window.anchor.stopRecording(windowId);
        } else {
          const meeting = await window.anchor.startRecording(windowId, m.title || "Desktop recording");
          m.meetingId = meeting.id;
          m.recording = true;
          renderMeetings();
        }
      } catch (err) {
        appendLog(`Error: ${err.message || err}`);
      } finally {
        btn.disabled = false;
      }
    };
    row.appendChild(label);
    row.appendChild(btn);
    meetingsEl.appendChild(row);
  }
}

async function refreshStatus() {
  const config = await window.anchor.getConfig();
  statusEl.textContent = config.hasToken ? `Connected to ${config.apiBase}` : "Not connected — paste a token below";
}

saveTokenBtn.onclick = async () => {
  const token = tokenInput.value.trim();
  if (!token) return;
  await window.anchor.setToken(token);
  tokenInput.value = "";
  appendLog("Desktop token saved.");
  refreshStatus();
};

window.anchor.onMeetingDetected((win) => {
  meetings.set(win.id, { title: win.title || win.platform || win.id, recording: false });
  renderMeetings();
});

window.anchor.onMeetingClosed((win) => {
  meetings.delete(win.id);
  renderMeetings();
});

window.anchor.onRecordingStarted((win) => {
  const m = meetings.get(win.id);
  if (m) {
    m.recording = true;
    renderMeetings();
  }
});

window.anchor.onRecordingEnded((win) => {
  const m = meetings.get(win.id);
  if (m) {
    m.recording = false;
    renderMeetings();
  }
});

window.anchor.onLog(appendLog);
window.anchor.onSdkError((evt) => appendLog(`SDK error: ${evt.message || JSON.stringify(evt)}`));
window.anchor.onTokenConnected(() => {
  // Fired after a one-click anchor-desktop://connect link from the
  // website saves a token automatically — same save-token codepath the
  // token-input box below already used, just without anyone having to
  // copy/paste it by hand. Refresh the "Connected to ..." status line so
  // that's visibly true immediately.
  refreshStatus();
});

refreshStatus();
