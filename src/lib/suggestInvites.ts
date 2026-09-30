// Finds commitments in a meeting that deserve a calendar event.
// Takes the model call as a parameter (see findFollowUpMeetingsText in
// summarize.ts) so scripts/test-next-steps.ts can run it with a fake model.
import { z } from "zod";

export const InviteSuggestion = z.object({
  title: z.string().min(3).max(120),
  startISO: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/),
  durationMinutes: z.number().int().min(15).max(240),
  attendees: z.array(z.string().email()).max(20),
  sourceQuote: z.string().min(3).max(300), // exact words from the transcript
  confidence: z.enum(["high", "medium"]),
});
export type InviteSuggestion = z.infer<typeof InviteSuggestion>;

export type SuggestInput = {
  transcript: string;
  actionItems: string[];
  meetingDateISO: string; // date of the call, e.g. 2026-09-30
  timeZone: string;
  participants: { name: string; email?: string }[];
  workingHours?: { start: string; end: string }; // "09:00" / "18:00"
};

export function buildPrompt(i: SuggestInput): string {
  const people = i.participants.map((p) => `- ${p.name}${p.email ? ` <${p.email}>` : " (no email known)"}`).join("\n");
  return `You extract follow-up meetings that participants explicitly agreed to during a call.

Meeting date: ${i.meetingDateISO} (time zone ${i.timeZone})
Working hours: ${i.workingHours?.start ?? "09:00"}-${i.workingHours?.end ?? "18:00"}
Participants:
${people}

Action items already extracted:
${i.actionItems.map((a) => `- ${a}`).join("\n") || "- none"}

Transcript:
"""
${i.transcript}
"""

Rules:
- Only suggest an event when someone agreed to meet, review, demo, check in or reconvene. Tasks like "send the proposal" are NOT meetings unless a call to review them was agreed.
- Resolve relative dates ("Friday", "next week") against the meeting date. If no time was said, pick 10:00 within working hours. Never schedule in the past.
- Attendees: only emails listed above. Never invent an email; leave out anyone without one.
- sourceQuote must be copied verbatim from the transcript.
- confidence "high" only when a specific day was agreed; otherwise "medium". Skip anything weaker.
- Return at most 3 suggestions.

Respond with ONLY a JSON array (no prose, no code fences) of objects:
{"title": string, "startISO": "YYYY-MM-DDTHH:MM", "durationMinutes": number, "attendees": string[], "sourceQuote": string, "confidence": "high"|"medium"}
Return [] if there are none.`;
}

export async function suggestInvites(
  input: SuggestInput,
  callModel: (prompt: string) => Promise<string>,
): Promise<InviteSuggestion[]> {
  const raw = await callModel(buildPrompt(input));
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set(input.participants.map((p) => p.email?.toLowerCase()).filter(Boolean) as string[]);
  const now = new Date(`${input.meetingDateISO}T00:00:00`);
  return parsed
    .map((s) => InviteSuggestion.safeParse(s))
    .filter((r): r is { success: true; data: InviteSuggestion } => r.success)
    .map((r) => ({ ...r.data, attendees: r.data.attendees.filter((e) => allowed.has(e.toLowerCase())) }))
    .filter((s) => new Date(s.startISO) >= now) // drop hallucinated past dates
    .filter((s) => input.transcript.includes(s.sourceQuote.slice(0, 40))) // quote must really be in the transcript
    .slice(0, 3);
}

export function endISO(startISO: string, minutes: number): string {
  const [d, t] = startISO.split("T");
  const [h, m] = t.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${d}T${hh}:${mm}:00`; // same-day meetings only (max 240 min, working hours)
}
