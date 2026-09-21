// Integration with Recall.ai's meeting bot API: sends an automatic bot
// into a Zoom / Google Meet / Teams call to record it, so the user
// doesn't have to manually record and upload a file. Verified against
// Recall.ai's live docs (docs.recall.ai) in Sept 2026 — their API is
// region-scoped, so RECALL_REGION must match whatever region the
// account's API key was generated in.
//
// Flow: createBot() when the user pastes a meeting link -> Recall joins
// the call -> when it's done, Recall calls our webhook
// (/api/webhooks/recall) -> getBot() there to fetch the recorded audio's
// download URL -> we download it and hand it to the same
// transcribe/summarize pipeline a manual upload uses.

const REGION = process.env.RECALL_REGION || "us-east-1";
const API_KEY = process.env.RECALL_API_KEY;
const BASE_URL = `https://${REGION}.recall.ai/api/v1`;

function authHeaders() {
  if (!API_KEY) throw new Error("RECALL_API_KEY is not set");
  return {
    Authorization: `Token ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function createBot(
  meetingUrl: string,
  liveTranscriptWebhookUrl?: string,
  joinAt?: string
): Promise<{ id: string }> {
  const recordingConfig: Record<string, unknown> = {
    // Only request mixed audio for the final recording — we run our own
    // transcription (AssemblyAI) on it after the call rather than paying
    // for Recall's built-in one for the async pass.
    audio_mixed: {},
  };

  // Separately, ask Recall's own low-latency streaming ASR for live
  // utterances *during* the call, delivered to our webhook as they're
  // finalized — this is what drives the live transcript + coaching on
  // the During tab. Independent of the async AssemblyAI pass above.
  if (liveTranscriptWebhookUrl) {
    recordingConfig.transcript = {
      provider: {
        recallai_streaming: {
          mode: "prioritize_low_latency",
          language_code: "en",
        },
      },
      diarization: {
        use_separate_streams_when_available: true,
      },
    };
  }

  const body: Record<string, unknown> = {
    meeting_url: meetingUrl,
    bot_name: "Anchor",
    recording_config: recordingConfig,
  };

  // Scheduling ahead of time (rather than the default "join now") hands
  // the actual join timing to Recall's own infra via join_at — bots
  // scheduled more than 10 minutes ahead are guaranteed on-time even if
  // this app happens to be asleep (Render free-tier cold start) right
  // when the meeting starts. See docs.recall.ai's "Creating and
  // scheduling bots" page.
  if (joinAt) {
    body.join_at = joinAt;
  }

  if (liveTranscriptWebhookUrl) {
    body.realtime_endpoints = [
      {
        type: "webhook",
        url: liveTranscriptWebhookUrl,
        events: ["transcript.data"],
      },
    ];
  }

  const res = await fetch(`${BASE_URL}/bot/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Recall.ai couldn't join that meeting (${res.status}): ${detail || "no details"}`
    );
  }

  return res.json();
}

// Ends a live "Send Anchor to a live meeting" bot early, instead of
// waiting for everyone else to leave the call (or the bot to eventually
// time out on its own). Per docs.recall.ai's "Remove Bot From Call"
// reference (checked Sept 2026): POST /bot/{id}/leave_call/, no body,
// irreversible. This does NOT end the call for anyone else on it — it
// only tells Anchor's bot to leave; the person on the call keeps going
// same as if Anchor had never joined. Anything already recorded up to
// this point still finishes processing normally — Recall.ai fires the
// same recording.done webhook it always does once a bot leaves a call
// (see src/app/api/webhooks/recall/route.ts), whether that's because
// this was called or because the call itself just ended.
export async function leaveCall(botId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/bot/${botId}/leave_call/`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Recall.ai couldn't end that call (${res.status}): ${detail || "no details"}`
    );
  }
}

type RecallBot = {
  id: string;
  media_shortcuts?: {
    audio_mixed?: {
      data?: {
        download_url?: string;
      };
    };
  };
};

export async function getBot(botId: string): Promise<RecallBot> {
  const res = await fetch(`${BASE_URL}/bot/${botId}/`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch bot ${botId} from Recall.ai (${res.status})`);
  }
  return res.json();
}

export async function downloadBotAudio(botId: string): Promise<Buffer> {
  const bot = await getBot(botId);
  const url = bot.media_shortcuts?.audio_mixed?.data?.download_url;
  if (!url) {
    throw new Error(
      "Recall.ai bot finished but no audio_mixed recording was available"
    );
  }
  const audioRes = await fetch(url);
  if (!audioRes.ok) {
    throw new Error(`Failed to download recording audio (${audioRes.status})`);
  }
  return Buffer.from(await audioRes.arrayBuffer());
}
