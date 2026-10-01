import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { dealFiles, deals, meetingParticipants, meetings, transcripts } from "@/db/schema";
import type { Source } from "@/lib/askRetrieval";

// Loads the raw material Ask Anchor searches before answering (see
// askRetrieval.ts): every finished call's transcript, the full extracted
// text of every attached document, and the email digest, for the given
// deals. Callers must only pass deals the person can see.

const MAX_CALLS = 40;
const MAX_FILES = 60;

function timestamp(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export async function loadAskSources(params: {
  dealIds: string[];
  // Also search this person's own calls that aren't on any deal.
  includeUnassignedFor?: string;
}): Promise<Source[]> {
  const { dealIds } = params;
  const meetingScope = dealIds.length
    ? params.includeUnassignedFor
      ? or(inArray(meetings.dealId, dealIds), and(isNull(meetings.dealId), eq(meetings.userId, params.includeUnassignedFor)))
      : inArray(meetings.dealId, dealIds)
    : params.includeUnassignedFor
      ? and(isNull(meetings.dealId), eq(meetings.userId, params.includeUnassignedFor))
      : null;

  const [calls, files, dealRows] = await Promise.all([
    meetingScope
      ? db
          .select({
            id: meetings.id,
            title: meetings.title,
            occurredAt: meetings.occurredAt,
            fullText: transcripts.fullText,
            utterances: transcripts.utterances,
          })
          .from(meetings)
          .innerJoin(transcripts, eq(transcripts.meetingId, meetings.id))
          .where(meetingScope)
          .orderBy(desc(meetings.occurredAt))
          .limit(MAX_CALLS)
      : Promise.resolve([]),
    dealIds.length
      ? db
          .select({ fileName: dealFiles.fileName, text: dealFiles.extractedText, dealId: dealFiles.dealId })
          .from(dealFiles)
          .where(inArray(dealFiles.dealId, dealIds))
          .orderBy(desc(dealFiles.createdAt))
          .limit(MAX_FILES)
      : Promise.resolve([]),
    dealIds.length
      ? db.select({ id: deals.id, name: deals.name, emailContext: deals.emailContext }).from(deals).where(inArray(deals.id, dealIds))
      : Promise.resolve([]),
  ]);

  const speakerRows = calls.length
    ? await db
        .select({ meetingId: meetingParticipants.meetingId, speakerLabel: meetingParticipants.speakerLabel, displayName: meetingParticipants.displayName })
        .from(meetingParticipants)
        .where(inArray(meetingParticipants.meetingId, calls.map((c) => c.id)))
    : [];
  const speakerName = new Map(speakerRows.map((s) => [`${s.meetingId}:${s.speakerLabel}`, s.displayName || s.speakerLabel]));
  const dealName = new Map(dealRows.map((d) => [d.id, d.name]));
  const multipleDeals = dealIds.length > 1;

  const sources: Source[] = [];
  for (const c of calls) {
    const text = c.utterances?.length
      ? c.utterances
          .map((u) => `[${timestamp(u.startMs)}] ${speakerName.get(`${c.id}:${u.speakerLabel}`) ?? u.speakerLabel}: ${u.text}`)
          .join("\n")
      : c.fullText;
    sources.push({ kind: "call", label: `Call "${c.title}", ${c.occurredAt.toISOString().slice(0, 10)}`, text });
  }
  for (const f of files) {
    if (!f.text) continue;
    const deal = multipleDeals ? dealName.get(f.dealId) : null;
    sources.push({ kind: "document", label: `Document "${f.fileName}"${deal ? ` (${deal})` : ""}`, text: f.text });
  }
  for (const d of dealRows) {
    if (d.emailContext) sources.push({ kind: "email", label: `Emails with ${d.name}`, text: d.emailContext });
  }
  return sources;
}
