"use client";

// Live transcript for an in-person recording via AssemblyAI's streaming
// speech-to-text, fed from the same mic stream the recording uses. Far
// more accurate than the browser's built-in speech recognition, works in
// every browser, punctuates (which question detection keys on), and is
// biased toward the deal's own names via key terms. Returns null when it
// can't start (no AssemblyAI key on the server, network, unsupported
// audio), so the caller can fall back to the browser's recognizer.

const TARGET_SAMPLE_RATE = 16_000;
// Each audio message to AssemblyAI: 50ms of 16kHz audio. AssemblyAI wants
// chunks between 50ms and 1s; small ones keep latency down.
const CHUNK_SAMPLES = 800;
// An in-progress turn that stops changing for this long (the speaker
// paused) is checked for a question before AssemblyAI finalizes it.
const PARTIAL_PAUSE_MS = 500;

export type LiveTranscriptHandlers = {
  // A finished line to store in the live transcript.
  onFinal: (text: string) => void;
  // An in-progress line, only to be checked for a question.
  onPartial: (text: string) => void;
  // The session died mid-call and couldn't be resumed.
  onFailed: () => void;
};

// Resamples the mic to 16kHz mono 16-bit PCM inside an AudioWorklet (off
// the main thread) and posts it in CHUNK_SAMPLES-sized pieces.
const WORKLET_SOURCE = `
class Pcm16Downsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.targetRate;
    this.chunk = options.processorOptions.chunkSamples;
    this.buffer = new Int16Array(this.chunk);
    this.filled = 0;
    this.pos = 0;
    this.last = 0;
    this.filtered = 0;
    // One-pole low-pass at ~7kHz so content above the new Nyquist
    // (8kHz) doesn't fold back in as noise.
    this.alpha = 1 - Math.exp((-2 * Math.PI * 7000) / sampleRate);
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    const ch = new Float32Array(input.length);
    for (let k = 0; k < input.length; k++) {
      this.filtered += this.alpha * (input[k] - this.filtered);
      ch[k] = this.filtered;
    }
    // Position p is measured in a virtual array [last, ...ch], so
    // interpolation works across block boundaries.
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = i === 0 ? this.last : ch[i - 1];
      const s = Math.max(-1, Math.min(1, a + (ch[i] - a) * f));
      this.buffer[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === this.chunk) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.chunk);
        this.filled = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    this.last = ch[ch.length - 1];
    return true;
  }
}
registerProcessor("pcm16-downsampler", Pcm16Downsampler);
`;

async function fetchToken(meetingId: string): Promise<{ token: string; keyterms: string[] } | null> {
  try {
    const res = await fetch(`/api/meetings/${meetingId}/live-transcription-token`, { method: "POST" });
    if (!res.ok) return null;
    const body = await res.json();
    if (typeof body.token !== "string") return null;
    return { token: body.token, keyterms: Array.isArray(body.keyterms) ? body.keyterms : [] };
  } catch {
    return null;
  }
}

function reportUsage(meetingId: string, ms: number) {
  if (ms < 1000) return;
  // keepalive so it still goes out if the tab is closing.
  void fetch(`/api/meetings/${meetingId}/live-transcription-usage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seconds: Math.round(ms / 1000) }),
    keepalive: true,
  }).catch(() => {});
}

export async function startStreamingTranscription(
  meetingId: string,
  stream: MediaStream,
  handlers: LiveTranscriptHandlers
): Promise<(() => void) | null> {
  if (typeof AudioWorkletNode === "undefined") return null;

  const first = await fetchToken(meetingId);
  if (!first) return null;

  const { StreamingTranscriber } = await import("assemblyai/streaming");

  let audioContext: AudioContext;
  let worklet: AudioWorkletNode;
  let source: MediaStreamAudioSourceNode;
  let workletUrl: string | null = null;
  try {
    audioContext = new AudioContext();
    workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    await audioContext.audioWorklet.addModule(workletUrl);
    source = audioContext.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(audioContext, "pcm16-downsampler", {
      processorOptions: { targetRate: TARGET_SAMPLE_RATE, chunkSamples: CHUNK_SAMPLES },
    });
  } catch (err) {
    console.warn("[live transcription] couldn't set up audio capture:", err);
    if (workletUrl) URL.revokeObjectURL(workletUrl);
    return null;
  }

  let stopped = false;
  // AssemblyAI bills streaming by how long sessions are open; summed here
  // and reported when transcription stops (see reportUsage).
  let billedMs = 0;
  let sessionStartedAt: number | null = null;
  const endSession = () => {
    if (sessionStartedAt != null) billedMs += Date.now() - sessionStartedAt;
    sessionStartedAt = null;
  };
  let transcriber: InstanceType<typeof StreamingTranscriber> | null = null;
  let partialTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPartialSent = "";
  // Each turn arrives several times: in progress, ended (unformatted) and
  // then ended and formatted. Only the formatted final is stored; the
  // unformatted end is checked for a question right away so it doesn't
  // wait on formatting.
  const storedTurns = new Set<number>();
  const checkedTurns = new Set<number>();

  const sendPartial = (text: string) => {
    if (text === lastPartialSent) return;
    lastPartialSent = text;
    handlers.onPartial(text);
  };

  const connect = async (token: string, keyterms: string[]) => {
    const next = new StreamingTranscriber({
      token,
      sampleRate: TARGET_SAMPLE_RATE,
      encoding: "pcm_s16le",
      formatTurns: true,
      ...(keyterms.length ? { keytermsPrompt: keyterms } : {}),
    });
    next.on("turn", (turn) => {
      const text = turn.transcript.trim();
      if (partialTimer) clearTimeout(partialTimer);
      if (!text) return;
      if (turn.end_of_turn && turn.turn_is_formatted) {
        if (storedTurns.has(turn.turn_order)) return;
        storedTurns.add(turn.turn_order);
        handlers.onFinal(text);
        return;
      }
      if (turn.end_of_turn) {
        if (checkedTurns.has(turn.turn_order)) return;
        checkedTurns.add(turn.turn_order);
        sendPartial(text);
        return;
      }
      if (text.split(/\s+/).length >= 3) {
        partialTimer = setTimeout(() => sendPartial(text), PARTIAL_PAUSE_MS);
      }
    });
    next.on("error", (err) => console.warn("[live transcription] streaming error:", err));
    next.on("close", () => {
      if (transcriber === next) endSession();
      if (stopped || transcriber !== next) return;
      // Dropped mid-call (network blip, the session hit its time limit) —
      // reconnect with a fresh token rather than going quiet.
      transcriber = null;
      void reconnect();
    });
    await next.connect();
    transcriber = next;
    sessionStartedAt = Date.now();
  };

  let reconnecting = false;
  const reconnect = async () => {
    if (reconnecting || stopped) return;
    reconnecting = true;
    for (let attempt = 0; attempt < 3 && !stopped; attempt++) {
      const fresh = await fetchToken(meetingId);
      if (fresh) {
        try {
          await connect(fresh.token, fresh.keyterms);
          reconnecting = false;
          return;
        } catch (err) {
          console.warn("[live transcription] reconnect failed:", err);
        }
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    reconnecting = false;
    if (!stopped) {
      teardown();
      handlers.onFailed();
    }
  };

  const teardown = () => {
    stopped = true;
    endSession();
    reportUsage(meetingId, billedMs);
    if (partialTimer) clearTimeout(partialTimer);
    worklet.port.onmessage = null;
    try {
      source.disconnect();
      worklet.disconnect();
    } catch {
      // Already disconnected.
    }
    void audioContext.close().catch(() => {});
    if (workletUrl) URL.revokeObjectURL(workletUrl);
  };

  try {
    await connect(first.token, first.keyterms);
  } catch (err) {
    console.warn("[live transcription] couldn't connect to AssemblyAI:", err);
    teardown();
    return null;
  }

  worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (!stopped) transcriber?.sendAudio(e.data);
  };
  source.connect(worklet);
  // Some browsers only run a worklet that's connected through to the
  // output; it writes no output samples, so nothing is audible.
  worklet.connect(audioContext.destination);
  if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});

  return () => {
    if (stopped) return;
    const last = transcriber;
    teardown();
    // Lets AssemblyAI send the final turn for whatever was said last.
    void last?.close(true, 2_000).catch(() => {});
  };
}
