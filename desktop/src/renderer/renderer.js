// Plain-JS renderer (not TypeScript — this runs directly in Electron's
// Chromium renderer process, unbuilt) for Anchor Desktop. Talks only to
// window.anchor, the narrow bridge preload.ts exposes — never Node/
// Electron APIs directly.

const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const accountEmailEl = document.getElementById("account-email");
const tokenInput = document.getElementById("token-input");
const saveTokenBtn = document.getElementById("save-token");
const signInBtn = document.getElementById("sign-in");
const switchAccountBtn = document.getElementById("switch-account");
const signedOutEl = document.getElementById("signed-out");
const signedInEl = document.getElementById("signed-in");
const meetingsEl = document.getElementById("meetings");
const logEl = document.getElementById("log");
const accountAvatarEl = document.getElementById("account-avatar");
const footEl = document.getElementById("foot");

// Same window on macOS and Windows; only the room left for the OS window
// controls (see .titlebar in index.html) and a few words differ.
const platform = (window.anchor && window.anchor.platform) || "darwin";
document.body.classList.add(`platform-${platform}`);
const IS_MAC = platform === "darwin";
footEl.textContent = IS_MAC
  ? "Closing this window keeps Anchor running in your menu bar, watching for calls. Click the anchor icon near your clock to reopen it or quit."
  : "Closing this window keeps Anchor running in the system tray, watching for calls. Click the anchor icon by the clock (bottom-right, maybe under ^) to reopen it or quit.";

const SPARKLE_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f0b48f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
const ANCHOR_SVG =
  '<svg width="26" height="26" viewBox="0 0 32 32" fill="none" stroke="#12294a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="16" cy="7.5" r="2.25"/><path d="M16 9.75V24.5"/><path d="M11 13.5H21"/><path d="M8 18.5C8 22.5 11.5 25.5 16 25.5C20.5 25.5 24 22.5 24 18.5"/><path d="M8 18.5L6 15.8M8 18.5L10.3 17"/><path d="M24 18.5L26 15.8M24 18.5L21.7 17"/></svg>';

function watchingHtml() {
  const signedIn = isConnected;
  return `<div class="watching"><div class="radar">${ANCHOR_SVG}</div><h2>${
    signedIn ? "Watching for calls" : "Sign in to start"
  }</h2><p class="hint">${
    signedIn
      ? "Open a Zoom, Teams or Meet call and it shows up here. Anchor starts recording on its own — nobody joins your call."
      : "Once you're signed in, Anchor spots your Zoom, Teams and Meet calls and records them from this computer."
  }</p><div class="apps"><span class="app-chip">Zoom</span><span class="app-chip">Microsoft Teams</span><span class="app-chip">Google Meet</span></div></div>`;
}

// windowId -> {
//   title, recording, meetingId, dealId,
//   tasks, tasksLoading,           -- the "to do for this deal" panel
//   suggestions,                   -- the live-coaching panel ({nudges, checklist, liveQuestion} | null)
//   askQuestion, askAnswer, askLoading,  -- the Ask Anchor panel
// }
// dealId is null whenever this call wasn't auto-matched to a deal (see
// AnchorApi.matchDealNow on the main-process side) — the three panels
// below are all deal-scoped, so a null dealId means a placeholder
// instead of any of them.
const meetings = new Map();

// The one Ask Anchor request currently in flight, if any — lets the
// single onAskAnchorChunk stream (see below) know which meeting's panel
// to update. This UI only ever has one active call in flight at a time
// in practice (a person is on one call), so a single module-level slot
// is enough; a second question can't be asked until the first resolves
// (the Ask button disables itself meanwhile).
let askingWindowId = null;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function appendLog(message) {
  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// Live suggestions as cards, like the website's: an unanswered question
// first (copper "ASK" tag), then each nudge ("SUGGESTED"), then the
// call's checklist.
function renderSuggestionsHtml(suggestions) {
  if (!suggestions) {
    return '<p class="hint">Suggestions show up here once Anchor has enough of the call to work with.</p>';
  }
  let html = "";
  if (suggestions.liveQuestion) {
    html += `<div class="suggestion question"><span class="tag">THEY ASKED</span><div class="suggestion-text">${escapeHtml(
      suggestions.liveQuestion.question
    )}</div><div class="suggested-answer">${escapeHtml(suggestions.liveQuestion.suggestedAnswer)}</div></div>`;
  }
  if (suggestions.nudges && suggestions.nudges.length) {
    html += suggestions.nudges
      .map(
        (n) =>
          `<div class="suggestion"><span class="tag">SUGGESTION</span><div class="suggestion-text">${escapeHtml(n)}</div></div>`
      )
      .join("");
  }
  if (suggestions.checklist && suggestions.checklist.length) {
    html += `<ul class="checklist">${suggestions.checklist
      .map((c) => `<li class="${c.covered ? "covered" : ""}"><span aria-hidden="true">${c.covered ? "✓" : "○"}</span><span>${escapeHtml(c.label)}</span></li>`)
      .join("")}</ul>`;
  }
  if (!html) {
    html = '<p class="hint">Nothing to flag yet — Anchor is listening.</p>';
  }
  return html;
}

function renderTasksHtml(m) {
  if (m.tasksLoading) return '<p class="hint">Loading…</p>';
  if (!m.tasks || m.tasks.length === 0) return '<p class="hint">No open tasks for this deal.</p>';
  return m.tasks
    .map(
      (t) =>
        `<label class="task-row"><input type="checkbox" data-task-id="${escapeHtml(t.id)}" /><span>${escapeHtml(t.text)}${
          t.ownerLabel ? ` <em>(${escapeHtml(t.ownerLabel)})</em>` : ""
        }</span></label>`
    )
    .join("");
}

function attachTaskHandlers(windowId, container) {
  container.querySelectorAll('input[type="checkbox"][data-task-id]').forEach((cb) => {
    cb.onclick = () => handleToggleTask(windowId, cb.dataset.taskId);
  });
}

function updateTasksPanel(windowId) {
  const m = meetings.get(windowId);
  const container = document.getElementById(`tasks-${windowId}`);
  if (!m || !container) return;
  container.innerHTML = renderTasksHtml(m);
  attachTaskHandlers(windowId, container);
}

function updateSuggestionsPanel(windowId) {
  const m = meetings.get(windowId);
  const container = document.getElementById(`suggestions-${windowId}`);
  if (!m || !container) return;
  container.innerHTML = renderSuggestionsHtml(m.suggestions);
}

function updateAskAnswer(windowId) {
  const m = meetings.get(windowId);
  const container = document.getElementById(`ask-answer-${windowId}`);
  if (!m || !container) return;
  const thinking = m.askLoading && !m.askAnswer;
  container.textContent = thinking ? "Thinking…" : m.askAnswer;
  container.classList.toggle("thinking", thinking);
  container.hidden = !thinking && !m.askAnswer;
}

// Fetches this deal's open tasks once a recording starts (or right
// after a manual Record click) — never throws; a failure just leaves
// the "no open tasks" placeholder up, same as a genuinely empty list.
async function loadDealTasks(windowId) {
  const m = meetings.get(windowId);
  if (!m || !m.dealId) return;
  m.tasksLoading = true;
  updateTasksPanel(windowId);
  try {
    const { tasks } = await window.anchor.getDealTasks(m.dealId);
    m.tasks = tasks || [];
  } catch (err) {
    appendLog(`Couldn't load this deal's tasks: ${err.message || err}`);
  } finally {
    m.tasksLoading = false;
    updateTasksPanel(windowId);
  }
}

// Checking a box here always means "mark done" (matches the web app's
// own home-page checkboxes) — there's no undo from this panel, since
// the desktop window only ever lists OPEN tasks to begin with (see
// /api/desktop/deals/[id]/tasks). Optimistically removes the row, and
// puts it back if the request fails.
async function handleToggleTask(windowId, taskId) {
  const m = meetings.get(windowId);
  if (!m) return;
  const idx = m.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return;
  const [task] = m.tasks.splice(idx, 1);
  updateTasksPanel(windowId);
  try {
    await window.anchor.toggleTask(taskId, true);
  } catch (err) {
    appendLog(`Couldn't mark that task done: ${err.message || err}`);
    m.tasks.splice(idx, 0, task);
    updateTasksPanel(windowId);
  }
}

async function handleAskAnchor(windowId, btn) {
  const m = meetings.get(windowId);
  if (!m || !m.dealId) return;
  const question = (m.askQuestion || "").trim();
  if (!question) return;
  askingWindowId = windowId;
  m.askLoading = true;
  m.askAnswer = "";
  updateAskAnswer(windowId);
  if (btn) btn.disabled = true;
  try {
    const { answer } = await window.anchor.askAnchor(m.dealId, question);
    m.askAnswer = answer;
  } catch (err) {
    m.askAnswer = `Couldn't get an answer: ${err.message || err}`;
  } finally {
    m.askLoading = false;
    if (askingWindowId === windowId) askingWindowId = null;
    updateAskAnswer(windowId);
    if (btn) btn.disabled = false;
  }
}

const MAX_TRANSCRIPT_LINES = 60;

function renderTranscriptHtml(m) {
  if (!m.transcript || m.transcript.length === 0) {
    return '<p class="hint">Listening… lines appear here as people speak.</p>';
  }
  return m.transcript
    .map(
      (l) =>
        `<div class="line"><div class="speaker">${escapeHtml(l.speaker || "Speaker")}</div><div class="text">${escapeHtml(l.text)}</div></div>`
    )
    .join("");
}

function updateTranscriptPanel(windowId) {
  const m = meetings.get(windowId);
  const container = document.getElementById(`transcript-${windowId}`);
  if (!m || !container) return;
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
  container.innerHTML = renderTranscriptHtml(m);
  if (atBottom) container.scrollTop = container.scrollHeight;
}

// The live view while a call records, laid out like the product design:
// the transcript on the left, suggestions (and this deal's to-dos) on the
// right, and an "Ask Anchor" bar along the bottom.
function renderDealPanel(windowId, m) {
  const panel = document.createElement("div");
  panel.className = "deal-panel";

  const grid = document.createElement("div");
  grid.className = "live-grid";

  const transcriptCol = document.createElement("div");
  transcriptCol.className = "live-col transcript-col";
  transcriptCol.innerHTML = `<p class="label"><span class="live-dot" aria-hidden="true"></span>Live transcript</p><div id="transcript-${windowId}" class="transcript">${renderTranscriptHtml(m)}</div>`;
  grid.appendChild(transcriptCol);

  const sideCol = document.createElement("div");
  sideCol.className = "live-col";
  if (!m.dealId) {
    sideCol.innerHTML =
      '<p class="label">Suggestions</p><p class="hint">This call isn\'t linked to a deal yet. Link it from Anchor\'s website to see live suggestions, tasks and Ask Anchor here.</p>';
  } else {
    sideCol.innerHTML = `<p class="label">Suggestions</p><div id="suggestions-${windowId}">${renderSuggestionsHtml(
      m.suggestions
    )}</div><div class="panel-section"><p class="label">To do for this deal</p><div id="tasks-${windowId}">${renderTasksHtml(
      m
    )}</div></div>`;
    attachTaskHandlers(windowId, sideCol);
  }
  grid.appendChild(sideCol);
  panel.appendChild(grid);

  if (m.dealId) {
    const askSection = document.createElement("div");
    askSection.className = "ask-panel";
    askSection.innerHTML = `
      <div class="ask-head">${SPARKLE_SVG}<span>Ask Anchor</span><span class="hint">about this deal and call</span></div>
      <div id="ask-answer-${windowId}" class="answer" ${m.askAnswer ? "" : "hidden"}>${escapeHtml(m.askAnswer)}</div>
      <div class="ask-row">
        <input type="text" class="ask-input" placeholder="Ask anything — what did they say about pricing?" aria-label="Ask Anchor" />
        <button class="ask-btn">Ask</button>
      </div>
    `;
    panel.appendChild(askSection);
    const askInput = askSection.querySelector(".ask-input");
    const askBtn = askSection.querySelector(".ask-btn");
    askInput.value = m.askQuestion || "";
    askInput.oninput = () => {
      m.askQuestion = askInput.value;
    };
    askInput.onkeydown = (e) => {
      if (e.key === "Enter") askBtn.click();
    };
    askBtn.onclick = () => handleAskAnchor(windowId, askBtn);
  }

  // Keep the newest transcript line in view.
  requestAnimationFrame(() => {
    const t = document.getElementById(`transcript-${windowId}`);
    if (t) t.scrollTop = t.scrollHeight;
  });
  return panel;
}

function renderMeetings() {
  // Signed out with nothing detected: the welcome card says it all.
  document.getElementById("calls-card").hidden = !isConnected && meetings.size === 0;
  if (meetings.size === 0) {
    meetingsEl.innerHTML = watchingHtml();
    updateStatusPill();
    return;
  }
  meetingsEl.innerHTML = "";
  for (const [windowId, m] of meetings) {
    const block = document.createElement("div");
    block.className = "meeting-block";

    const row = document.createElement("div");
    row.className = "meeting";
    const label = document.createElement("div");
    const titleEl = document.createElement("div");
    titleEl.className = "meeting-title";
    titleEl.textContent = m.title || windowId;
    const meta = document.createElement("div");
    meta.className = "meeting-meta";
    meta.innerHTML = m.recording
      ? `<span class="pill recording"><span class="dot"></span>Recording</span><span data-elapsed="${escapeHtml(windowId)}">${formatElapsed(Date.now() - (m.startedAt || Date.now()))}</span>`
      : '<span class="pill">Call detected</span><span>Not recording yet</span>';
    label.appendChild(titleEl);
    label.appendChild(meta);
    const btn = document.createElement("button");
    btn.textContent = m.recording ? "Stop recording" : "Record this call";
    btn.className = m.recording ? "stop" : "primary";
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (m.recording) {
          await window.anchor.stopRecording(windowId);
        } else {
          const meeting = await window.anchor.startRecording(windowId, m.title || "Desktop recording");
          m.meetingId = meeting.id;
          m.dealId = meeting.dealId || null;
          m.recording = true;
          m.startedAt = m.startedAt || Date.now();
          renderMeetings();
          if (m.dealId) loadDealTasks(windowId);
        }
      } catch (err) {
        appendLog(`Error: ${err.message || err}`);
      } finally {
        btn.disabled = false;
      }
    };
    row.appendChild(label);
    row.appendChild(btn);
    block.appendChild(row);

    if (m.recording) {
      block.appendChild(renderDealPanel(windowId, m));
    }

    meetingsEl.appendChild(block);
  }
  updateStatusPill();
}

let isConnected = false;

// Top-right pill: Recording (any call) > Connected > Not connected.
function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

function updateStatusPill() {
  const recordingStarts = [...meetings.values()].filter((m) => m.recording).map((m) => m.startedAt || Date.now());
  const recording = recordingStarts.length > 0;
  statusEl.className = `pill${recording ? " recording" : isConnected ? " connected" : ""}`;
  statusTextEl.textContent = recording
    ? `Recording ${formatElapsed(Date.now() - Math.min(...recordingStarts))}`
    : isConnected
      ? "Connected"
      : "Not connected";
}
// Ticks the recording timers (title bar and each call's row).
setInterval(() => {
  if (![...meetings.values()].some((m) => m.recording)) return;
  updateStatusPill();
  for (const [windowId, m] of meetings) {
    const el = m.recording && document.querySelector(`[data-elapsed="${CSS.escape(windowId)}"]`);
    if (el) el.textContent = formatElapsed(Date.now() - (m.startedAt || Date.now()));
  }
}, 1000);

async function refreshStatus() {
  const config = await window.anchor.getConfig();
  isConnected = config.hasToken;
  accountEmailEl.textContent = config.accountEmail || config.apiBase;
  accountAvatarEl.textContent = ((config.accountEmail || "A").trim()[0] || "A").toUpperCase();
  signedOutEl.hidden = config.hasToken;
  signedInEl.hidden = !config.hasToken;
  updateStatusPill();
  if (meetings.size === 0) renderMeetings();
}

// Opens Anchor's sign-in in the browser; the app connects itself when the
// browser hands the token back (see startSignIn / handleDeepLink in
// main.ts, and onTokenConnected below).
async function beginSignIn() {
  signInBtn.disabled = true;
  signInBtn.textContent = "Waiting for you to sign in in your browser…";
  try {
    await window.anchor.startSignIn();
  } catch (err) {
    appendLog(`Couldn't open your browser: ${err && err.message ? err.message : err}`);
  } finally {
    // Re-enable after a moment so they can try again if they closed the tab.
    setTimeout(() => {
      signInBtn.disabled = false;
      signInBtn.textContent = "Sign in to Anchor";
    }, 5000);
  }
}

signInBtn.onclick = beginSignIn;
switchAccountBtn.onclick = beginSignIn;

saveTokenBtn.onclick = async () => {
  const token = tokenInput.value.trim();
  if (!token) return;
  const result = await window.anchor.setToken(token);
  tokenInput.value = "";
  appendLog(result && result.accountEmail ? `Connected as ${result.accountEmail}.` : "Desktop token saved.");
  refreshStatus();
};

window.anchor.onMeetingDetected((win) => {
  meetings.set(win.id, {
    title: win.title || win.platform || win.id,
    recording: false,
    meetingId: null,
    dealId: null,
    tasks: [],
    tasksLoading: false,
    suggestions: null,
    transcript: [],
    startedAt: null,
    askQuestion: "",
    askAnswer: "",
    askLoading: false,
  });
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
    m.startedAt = m.startedAt || Date.now();
    if (win.meetingId) m.meetingId = win.meetingId;
    if (win.dealId !== undefined) m.dealId = win.dealId;
    renderMeetings();
    if (m.dealId) loadDealTasks(win.id);
  }
});

window.anchor.onTranscriptLine((line) => {
  const m = meetings.get(line.windowId);
  if (!m) return;
  m.transcript.push({ speaker: line.speaker, text: line.text });
  if (m.transcript.length > MAX_TRANSCRIPT_LINES) m.transcript.splice(0, m.transcript.length - MAX_TRANSCRIPT_LINES);
  updateTranscriptPanel(line.windowId);
});

window.anchor.onRecordingEnded((win) => {
  const m = meetings.get(win.id);
  if (m) {
    m.recording = false;
    m.startedAt = null;
    renderMeetings();
  }
});

window.anchor.onLiveSuggestionsUpdated((payload) => {
  const m = meetings.get(payload.windowId);
  if (!m) return;
  m.suggestions = payload.suggestions;
  updateSuggestionsPanel(payload.windowId);
});

window.anchor.onAskAnchorChunk((soFar) => {
  if (!askingWindowId) return;
  const m = meetings.get(askingWindowId);
  if (!m) return;
  m.askAnswer = soFar;
  updateAskAnswer(askingWindowId);
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
