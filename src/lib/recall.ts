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

// "Anchor.Lucia" instead of a plain "Anchor" in the call's participant
// list — lets anyone on the call (and the person who sent it) tell whose
// Anchor bot this is when more than one person on a team uses it. Falls
// back to plain "Anchor" if this account has no name set.
export function botDisplayName(userName: string | null | undefined): string {
  const first = userName?.trim().split(/\s+/)[0];
  return first ? `Anchor.${first}` : "Anchor";
}

export async function createBot(
  meetingUrl: string,
  liveTranscriptWebhookUrl?: string,
  joinAt?: string,
  // Shows up as this bot's display name in the actual Zoom/Meet/Teams
  // participant list — "Anchor" alone was confusing on a call with more
  // than one Anchor user, since there was no way to tell whose bot it
  // was. Defaults to plain "Anchor" for any caller that doesn't pass one.
  botName = "Anchor"
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
    bot_name: botName,
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
    const bodyText = await res.text().catch(() => "");
    // Recall's bot doesn't finish actually dialing into the call the
    // instant we create it — there's a real gap (a few seconds, longer
    // with a waiting room) between us marking the meeting "recording" and
    // the bot genuinely being in the call, and leave_call fails with this
    // specific code during that gap. Surfaced as something actionable
    // rather than the raw API error JSON.
    let code: string | undefined;
    try {
      code = JSON.parse(bodyText)?.code;
    } catch {
      // Not JSON — fall through to the generic error below.
    }
    if (code === "cannot_command_unstarted_bot") {
      throw new Error("Anchor is still joining the call — wait a few seconds and try Stop again.");
    }
    throw new Error(
      `Recall.ai couldn't end that call (${res.status}): ${bodyText || "no details"}`
    );
  }
}

// Best-effort cancel for a bot that was told to join but never actually
// made it into the call — Recall's "Delete Scheduled Bot" endpoint (per
// docs.recall.ai, checked Sept 2026). This only succeeds for a bot that
// hasn't attempted to join yet (still just scheduled); a bot already
// stuck mid-join (joining_call/in_waiting_room) 405s here, same as
// leave_call fails on it with cannot_command_unstarted_bot — there is no
// Recall-side way to force a genuinely mid-join bot to stop right now.
// Callers treat this as fire-and-forget and always fall back to ending
// the meeting locally in Anchor regardless of what this does.
export async function cancelBot(botId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/bot/${botId}/`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Recall.ai couldn't cancel bot ${botId} (${res.status}): ${detail || "no details"}`);
  }
}

// Friendly text for a bot.fatal webhook's sub_code (docs.recall.ai's "Bot
// Sub Codes" reference, checked Sept 2026) — shown to the user instead of
// a raw error code when Anchor's bot permanently fails to join a call.
const FATAL_SUB_CODE_MESSAGES: Record<string, string> = {
  bot_errored: "Anchor's bot ran into an unexpected error trying to join.",
  meeting_not_found: "Recall couldn't find a meeting at that link.",
  meeting_not_accessible: "Anchor's bot wasn't allowed into that meeting.",
  meeting_not_started: "The meeting hadn't started yet when Anchor's bot tried to join.",
  meeting_requires_registration: "That meeting requires registering in advance, so Anchor's bot couldn't join.",
  meeting_requires_sign_in: "That meeting only allows signed-in participants, so Anchor's bot couldn't join.",
  meeting_link_expired: "That meeting link had expired.",
  meeting_link_invalid: "That doesn't look like a valid meeting link.",
  meeting_password_incorrect: "The meeting password was incorrect.",
  meeting_locked: "The meeting was locked when Anchor's bot tried to join.",
  meeting_full: "The meeting was full when Anchor's bot tried to join.",
  meeting_ended: "The meeting had already ended before Anchor's bot could join.",
  failed_to_launch_in_time: "Anchor's bot didn't start in time — worth trying again.",
};

export function fatalBotMessage(subCode: string | null | undefined): string {
  if (subCode && FATAL_SUB_CODE_MESSAGES[subCode]) return FATAL_SUB_CODE_MESSAGES[subCode];
  return "Anchor's bot couldn't join that meeting.";
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

// --- Desktop Recording SDK (no-bot / "Granola-style" recording) -----------
//
// Unlike the bot flow above (well-documented, verified against live
// webhook payloads earlier in this project), the exact response shape of
// sdk_upload creation and the exact webhook event Recall fires when an
// SDK upload finishes are NOT fully confirmed against Recall's reference
// docs as of writing this — their interactive docs pages wouldn't render
// full example payloads. What's below is grounded in Recall's own
// engineering blog (recall.ai/blog/how-to-build-a-desktop-recording-app,
// checked Sept 2026), which is a first-party source but less
// authoritative than the API reference. Treat field names here as "best
// available, not yet battle-tested" — src/app/api/webhooks/recall/route.ts
// logs the full raw payload of anything it doesn't recognize specifically
// so the real shape can be read off Render's logs the first time a real
// desktop recording completes, and this code adjusted if needed.

type SdkUploadCreateResponse = {
  upload_token?: string;
  recording_id?: string;
  id?: string;
};

// Creates an "upload slot" for one Desktop SDK recording — the desktop
// app's local RecallAiSdk.startRecording() call needs the upload_token
// this returns to know where to stream the recording to. recording_id
// (if present in the response — see the uncertainty note above) is what
// we store on the meeting row (recallRecordingId) to later match this
// recording up with its completion webhook.
//
// Also asks for the same real-time transcript stream the bot flow uses
// (recallai_streaming — see createBot() above), but delivered a
// different way: `realtime_endpoints` with type "desktop_sdk_callback"
// (confirmed via docs.recall.ai/docs/dsdk-realtime-transcription, Sept
// 2026 — unlike the sdk_upload response shape, this page rendered a
// concrete example) tells Recall to push transcript.data events straight
// to the desktop app's own RecallAiSdk.addEventListener("realtime-event",
// ...) instead of a webhook — see desktop/src/main.ts. The nested
// payload shape (data.words[].text, data.participant.name) is expected
// to match what src/app/api/webhooks/recall/transcript/route.ts already
// parses for bot calls, since it's the same provider — just delivered
// over the SDK instead of a webhook.
export async function createSdkUpload(): Promise<{ uploadToken: string; recordingId: string }> {
  const res = await fetch(`${BASE_URL}/sdk_upload/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      recording_config: {
        audio_mixed: {},
        transcript: {
          provider: {
            recallai_streaming: {
              mode: "prioritize_low_latency",
              language_code: "en",
            },
          },
        },
        realtime_endpoints: [
          {
            type: "desktop_sdk_callback",
            events: ["transcript.data"],
          },
        ],
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Recall.ai couldn't create a desktop recording upload (${res.status}): ${detail || "no details"}`);
  }
  const body = (await res.json()) as SdkUploadCreateResponse;
  const uploadToken = body.upload_token;
  // Fall back to `id` in case this particular account/API version calls
  // the created resource's own id "id" rather than "recording_id" — see
  // the uncertainty note above.
  const recordingId = body.recording_id || body.id;
  if (!uploadToken || !recordingId) {
    throw new Error(
      "Recall.ai's sdk_upload response didn't include the fields Anchor expected (upload_token/recording_id) — check Render logs for the raw response."
    );
  }
  return { uploadToken, recordingId };
}

type RecallRecording = {
  id: string;
  media_shortcuts?: {
    audio_mixed?: {
      data?: {
        download_url?: string;
      };
    };
  };
  // Defensive fallback in case a desktop-SDK recording's downloadable
  // media shows up at the top level instead of nested under
  // media_shortcuts the way a bot's does.
  download_url?: string;
};

export async function getRecording(recordingId: string): Promise<RecallRecording> {
  const res = await fetch(`${BASE_URL}/recording/${recordingId}/`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch recording ${recordingId} from Recall.ai (${res.status})`);
  }
  return res.json();
}

export async function downloadRecordingAudio(recordingId: string): Promise<Buffer> {
  const recording = await getRecording(recordingId);
  const url = recording.media_shortcuts?.audio_mixed?.data?.download_url || recording.download_url;
  if (!url) {
    throw new Error(
      "Recall.ai desktop recording finished but Anchor couldn't find a download URL in the response — check Render logs."
    );
  }
  const audioRes = await fetch(url);
  if (!audioRes.ok) {
    throw new Error(`Failed to download recording audio (${audioRes.status})`);
  }
  return Buffer.from(await audioRes.arrayBuffer());
}
