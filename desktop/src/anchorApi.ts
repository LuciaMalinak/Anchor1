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

  // Best-effort guess at which deal this call belongs to, based on
  // matching the signed-in user's Google Calendar against each deal's
  // known contacts for whatever's happening right now — see
  // src/app/api/desktop/deals/match-now/route.ts. Returns undefined
  // (never throws) on any failure, no Google connection, or no match, so
  // a recording always starts either way — just unassigned in that case,
  // same as before this existed.
  async matchDealNow(): Promise<{ dealId: string; dealName: string } | undefined> {
    try {
      const res = await this.request("/api/desktop/deals/match-now");
      if (!res.ok) return undefined;
      const body = await res.json().catch(() => ({}));
      return body.dealId ? { dealId: body.dealId, dealName: body.dealName || "" } : undefined;
    } catch {
      return undefined;
    }
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

  // `failed: true` marks a meeting that never actually started recording
  // (see the route's comment) so it doesn't stay stuck "live" forever.
  async stopMeeting(meetingId: string, opts?: { failed?: boolean }): Promise<void> {
    const res = await this.request(`/api/desktop/meetings/${meetingId}/stop`, {
      method: "POST",
      body: JSON.stringify({ failed: opts?.failed === true }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Anchor couldn't confirm this meeting stopped (${res.status})`);
    }
  }

  // Forwards one finalized transcript utterance from Recall's real-time
  // stream (see main.ts's "realtime-event" handler) — same endpoint the
  // in-browser in-person recorder uses (see MicRecorder.tsx in the main
  // repo), just bearer-authed instead of session-authed. speakerName and
  // relativeSeconds are optional since the in-person flow doesn't have
  // them.
  async pushLiveTranscript(
    meetingId: string,
    text: string,
    speakerName?: string | null,
    relativeSeconds?: number | null
  ): Promise<void> {
    await this.request(`/api/meetings/${meetingId}/live-transcript`, {
      method: "POST",
      body: JSON.stringify({ text, speakerName, relativeSeconds }),
    }).catch(() => {
      // Best-effort — a dropped live-transcript line isn't worth
      // interrupting a recording over. The full audio still gets
      // uploaded to Recall regardless and reaches Anchor via the
      // webhook once the call ends.
    });
  }
}
