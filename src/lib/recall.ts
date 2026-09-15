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

export async function createBot(meetingUrl: string): Promise<{ id: string }> {
  const res = await fetch(`${BASE_URL}/bot/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: "Anchor",
      // Only request mixed audio — we run our own transcription
      // (AssemblyAI) rather than paying for Recall's built-in one.
      recording_config: {
        audio_mixed: {},
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Recall.ai couldn't join that meeting (${res.status}): ${detail || "no details"}`
    );
  }

  return res.json();
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
