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
    html += `<div class="suggestion question"><span class="tag">ASK</span><div class="suggestion-text">${escapeHtml(
      suggestions.liveQuestion.question
    )}</div><div class="suggested-answer">${escapeHtml(suggestions.liveQuestion.suggestedAnswer)}</div></div>`;
  }
  if (suggestions.nudges && suggestions.nudges.length) {
    html += suggestions.nudges
      .map(
        (n) =>
          `<div class="suggestion"><span class="tag">SUGGESTED</span><div class="suggestion-text">${escapeHtml(n)}</div></div>`
      )
      .join("");
  }
  if (suggestions.checklist && suggestions.checklist.length) {
    html += `<ul class="checklist">${suggestions.checklist
      .map((c) => `<li class="${c.covered ? "covered" : ""}">${c.covered ? "✓" : "○"} ${escapeHtml(c.label)}</li>`)
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
  container.textContent = m.askLoading && !m.askAnswer ? "Thinking…" : m.askAnswer;
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

function renderDealPanel(windowId, m) {
  const panel = document.createElement("div");
  panel.className = "deal-panel";

  if (!m.dealId) {
    panel.innerHTML =
      '<p class="hint">Not linked to a deal yet — link this call from Anchor\'s web app to see live suggestions and tasks here.</p>';
    return panel;
  }

  const suggestionsSection = document.createElement("div");
  suggestionsSection.className = "panel-section";
  suggestionsSection.innerHTML = `<strong>Suggestions · from all your context</strong><div id="suggestions-${windowId}">${renderSuggestionsHtml(m.suggestions)}</div>`;
  panel.appendChild(suggestionsSection);

  const tasksSection = document.createElement("div");
  tasksSection.className = "panel-section";
  tasksSection.innerHTML = `<strong>To do for this deal</strong><div id="tasks-${windowId}">${renderTasksHtml(m)}</div>`;
  panel.appendChild(tasksSection);
  attachTaskHandlers(windowId, tasksSection);

  const askSection = document.createElement("div");
  askSection.className = "panel-section";
  askSection.innerHTML = `
    <strong>Ask Anchor</strong>
    <div class="ask-row">
      <input type="text" class="ask-input" placeholder="Ask Anchor anything…" />
      <button class="ask-btn">Ask</button>
    </div>
    <div id="ask-answer-${windowId}" class="ask-answer">${escapeHtml(m.askAnswer)}</div>
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

  return panel;
}

function renderMeetings() {
  if (meetings.size === 0) {
    meetingsEl.innerHTML =
      '<div class="empty"><h2>No call open</h2><p class="hint">Open a Zoom, Teams or Meet call and it shows up here. Anchor starts recording on its own.</p></div>';
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
      ? '<span class="pill recording"><span class="dot"></span>Recording</span>'
      : '<span class="pill">Detected</span>';
    label.appendChild(titleEl);
    label.appendChild(meta);
    const btn = document.createElement("button");
    btn.textContent = m.recording ? "Stop" : "Record";
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
function updateStatusPill() {
  const recording = [...meetings.values()].some((m) => m.recording);
  statusEl.className = `pill${recording ? " recording" : isConnected ? " connected" : ""}`;
  statusTextEl.textContent = recording ? "Recording" : isConnected ? "Connected" : "Not connected";
}

async function refreshStatus() {
  const config = await window.anchor.getConfig();
  isConnected = config.hasToken;
  accountEmailEl.textContent = config.accountEmail || config.apiBase;
  signedOutEl.hidden = config.hasToken;
  signedInEl.hidden = !config.hasToken;
  updateStatusPill();
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
    if (win.meetingId) m.meetingId = win.meetingId;
    if (win.dealId !== undefined) m.dealId = win.dealId;
    renderMeetings();
    if (m.dealId) loadDealTasks(win.id);
  }
});

window.anchor.onRecordingEnded((win) => {
  const m = meetings.get(win.id);
  if (m) {
    m.recording = false;
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
