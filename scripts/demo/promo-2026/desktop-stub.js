(() => {
  const h = {};
  const on = (k) => (cb) => { h[k] = cb; };
  window.__emit = (k, v) => h[k] && h[k](v);
  window.__tasks = [
    { id: "t1", text: "Send EMEA expansion pricing quote (10 seats)", ownerLabel: "Sam Rivera" },
    { id: "t2", text: "Confirm Slack integration roadmap timing", ownerLabel: "Sam Rivera" },
    { id: "t3", text: "Loop in Acme's EU legal team on data residency", ownerLabel: "Jordan Weiss" } ];
  window.anchor = {
    platform: "darwin",
    getConfig: async () => ({ hasToken: true, accountEmail: "sam.rivera@example.com", apiBase: "https://anchor" }),
    setToken: async () => ({}), startSignIn: async () => {},
    startRecording: async () => ({ id: "m1", dealId: "d1" }), stopRecording: async () => {},
    onMeetingDetected: on("detected"), onMeetingClosed: on("closed"), onRecordingStarted: on("started"), onRecordingEnded: on("ended"),
    onLog: on("log"), onSdkError: on("sdkerr"), onTranscriptLine: on("line"), onTokenConnected: on("token"),
    askAnchor: async (d, q) => { await new Promise(r => setTimeout(r, 200)); return { answer: window.__askAnswer || "" }; },
    getDealTasks: async () => ({ tasks: window.__tasks }),
    toggleTask: async () => ({ ok: true }),
    onAskAnchorChunk: on("chunk"), onLiveSuggestionsUpdated: on("sugg"),
  };
})();
