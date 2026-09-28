// Sends a text message via Twilio's plain REST API (no @twilio SDK
// dependency needed — it's just HTTP Basic Auth + a form-encoded POST).
// Twilio itself is a real account Lucia has to create and pay for
// herself, the same way Gmail's OAuth credentials needed her own
// sign-in — see TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER in
// render.yaml. Until those are set, this quietly no-ops (logs what
// would have been sent) instead of throwing, so everything upstream of
// it — the digest content, the opt-in toggle, the cron route — can be
// built and tested today and start actually texting people the moment
// those three env vars exist, with no code change.
export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
  );
}

export type SendSmsResult =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "request_failed"; detail?: string };

export async function sendSms(to: string, body: string): Promise<SendSmsResult> {
  if (!isSmsConfigured()) {
    console.log(`[sms] Twilio not configured yet — would have texted ${to}:\n${body}`);
    return { sent: false, reason: "not_configured" };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_NUMBER!;

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[sms] Twilio send to ${to} failed: ${res.status} ${detail}`);
      return { sent: false, reason: "request_failed", detail };
    }
    return { sent: true };
  } catch (err) {
    console.error(`[sms] Twilio send to ${to} threw:`, err);
    return { sent: false, reason: "request_failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
