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

export type LiveCoaching = {
  nudges: string[];
  checklist: { label: string; covered: boolean }[];
  liveQuestion: { question: string; suggestedAnswer: string } | null;
};

export type DealTask = {
  id: string;
  text: string;
  ownerLabel: string | null;
  completed: boolean;
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

  // Same route the web app's During tab / Focus window polls for a live
  // call's transcript + AI coaching (nudges, checklist, the one question
  // that looks unanswered) — see src/app/api/meetings/[id]/live/route.ts.
  // The server itself debounces the expensive part to once every ~8s, so
  // this is safe to poll on a similar cadence with no extra guard here.
  async getLiveSuggestions(meetingId: string): Promise<LiveCoaching | null> {
    try {
      const res = await this.request(`/api/meetings/${meetingId}/live`);
      if (!res.ok) return null;
      const body = await res.json().catch(() => ({}));
      return body.liveSuggestions ?? null;
    } catch {
      return null;
    }
  }

  // The open action items on whichever deal this recording is matched
  // to — see src/app/api/desktop/deals/[id]/tasks/route.ts. Never throws;
  // an empty list either means there's genuinely nothing open, or the
  // request failed, and the panel treats both the same (nothing to show).
  async getDealTasks(dealId: string): Promise<DealTask[]> {
    try {
      const res = await this.request(`/api/desktop/deals/${dealId}/tasks`);
      if (!res.ok) return [];
      const body = await res.json().catch(() => ({}));
      return Array.isArray(body.tasks) ? body.tasks : [];
    } catch {
      return [];
    }
  }

  // Checks (or unchecks) one task from the desktop to-do panel — same
  // route the web app's home page checkboxes use, see
  // src/app/api/tasks/[id]/route.ts.
  async toggleTask(taskId: string, completed: boolean): Promise<DealTask | null> {
    try {
      const res = await this.request(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) return null;
      const body = await res.json().catch(() => ({}));
      return body.task ?? null;
    } catch {
      return null;
    }
  }

  // Asks Anchor a question grounded in this deal's whole history — same
  // route and same streamed-plain-text response the web app's Ask Anchor
  // panel uses (see src/app/api/deals/[id]/assist/route.ts). onChunk is
  // called with the FULL answer-so-far each time more text arrives (not
  // just the delta), matching how the web panel renders it, so the
  // caller can just assign it straight to a text node.
  async askAnchor(dealId: string, question: string, onChunk: (soFar: string) => void): Promise<string> {
    const res = await this.request(`/api/deals/${dealId}/assist`, {
      method: "POST",
      body: JSON.stringify({ question, history: [] }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Anchor couldn't answer that (${res.status})`);
    }
    if (!res.body) {
      const text = await res.text();
      onChunk(text);
      return text;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
      onChunk(full);
    }
    return full;
  }
}
