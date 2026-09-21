// Thin wrapper around the Anchor web app's desktop-facing API routes
// (src/app/api/desktop/... and src/app/api/meetings/[id]/live-transcript
// in the main repo), all authenticated with the bearer token generated
// from Anchor's Integrations page instead of a browser session — see
// src/lib/apiToken.ts there.

export type AnchorMeeting = {
  id: string;
  title: string;
  status: string;
};

export class AnchorApi {
  constructor(
    private apiBase: string,
    private token: string
  ) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        ...(init?.headers ?? {}),
      },
    });
    return res;
  }

  // Creates the meeting row in Anchor and asks Recall.ai for an
  // uploadToken — see src/app/api/desktop/meetings/start/route.ts.
  async startMeeting(title: string, dealId?: string): Promise<{ meeting: AnchorMeeting; uploadToken: string }> {
    const res = await this.request("/api/desktop/meetings/start", {
      method: "POST",
      body: JSON.stringify({ title, dealId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Anchor rejected starting this meeting (${res.status})`);
    }
    return body;
  }

  async stopMeeting(meetingId: string): Promise<void> {
    const res = await this.request(`/api/desktop/meetings/${meetingId}/stop`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Anchor couldn't confirm this meeting stopped (${res.status})`);
    }
  }

  // Forwards one finalized transcript utterance — same endpoint the
  // in-browser in-person recorder uses (see MicRecorder.tsx in the main
  // repo), just bearer-authed instead of session-authed. Used once the
  // SDK's realtime-event transcript wiring is confirmed (Phase 2); kept
  // here now so main.ts has somewhere to send it the moment it is.
  async pushLiveTranscript(meetingId: string, text: string): Promise<void> {
    await this.request(`/api/meetings/${meetingId}/live-transcript`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }).catch(() => {
      // Best-effort — a dropped live-transcript line isn't worth
      // interrupting a recording over. The full audio still gets
      // uploaded to Recall regardless and reaches Anchor via the
      // webhook once the call ends.
    });
  }
}
