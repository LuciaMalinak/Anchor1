import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { answerPlaybook, deals, meetings, users, type LiveQuestionRecord } from "@/db/schema";
import { meteredFetch, withAiUser } from "@/lib/aiUsage";
import { createWithForcedTool } from "@/lib/forcedTool";
import type { Utterance } from "@/lib/transcribe";

// Anchor's answer playbook: how this team actually answers the questions
// clients ask. It grows two ways —
// - Taught: someone approves a live answer (thumbs up), corrects one
//   (thumbs down + what it should have said), or writes one on the
//   Playbook page.
// - Learned: after every call, Anchor reads what the team said in answer
//   to the client's questions and keeps those answers (learnFromCall).
// Live question answers (liveQuestion.ts) are given the closest entries,
// so the next answer sounds like the team and uses what they really said.

type Entry = typeof answerPlaybook.$inferSelect;

const STOPWORDS = new Set(
  "a an the and or but if then so of to in on at for with by from is are was were be been do does did can could would will should shall i you we they he she it this that these those your our my their what how why when where which who whom about any some there here me us them just also really".split(
    " "
  )
);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w))
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

// The same question asked a little differently.
const SAME_QUESTION = 0.75;

// Entries this team (and this deal) has, newest first. Cached briefly:
// live answers ask for them on every question.
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; rows: Entry[] }>();
const MAX_ENTRIES = 400;

async function entriesFor(teamId: string, dealId: string | null): Promise<Entry[]> {
  const key = `${teamId}:${dealId ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const rows = await db
    .select()
    .from(answerPlaybook)
    .where(
      and(
        eq(answerPlaybook.teamId, teamId),
        dealId ? or(isNull(answerPlaybook.dealId), eq(answerPlaybook.dealId, dealId)) : isNull(answerPlaybook.dealId)
      )
    )
    .orderBy(desc(answerPlaybook.updatedAt))
    .limit(MAX_ENTRIES);
  cache.set(key, { at: Date.now(), rows });
  if (cache.size > 500) cache.clear();
  return rows;
}

function forget(teamId: string) {
  for (const key of cache.keys()) if (key.startsWith(`${teamId}:`)) cache.delete(key);
}

// The few entries closest to this question: this deal's first, taught
// ones ahead of learned ones when equally close.
export async function relevantAnswers(teamId: string, dealId: string | null, question: string, limit = 5): Promise<Entry[]> {
  const q = words(question);
  const rows = await entriesFor(teamId, dealId);
  return rows
    .map((r) => ({
      r,
      score: overlap(q, words(r.question)) + (r.dealId ? 0.1 : 0) + (r.source === "taught" ? 0.05 : 0),
    }))
    .filter((x) => x.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.r);
}

export function playbookText(entries: Entry[]): string {
  if (!entries.length) return "";
  return `How this team has actually answered similar questions before (taught = a person approved or wrote it; call = what they said on a past call). Use these whenever they fit — they're the team's real answers and wording — unless this deal's facts say otherwise:\n${entries
    .map((e) => `- [${e.source}${e.dealId ? ", this deal" : ""}] Q: ${e.question}\n  A: ${e.answer}`)
    .join("\n")}`;
}

// Saves an answer a person approved, corrected or wrote. Replaces the
// entry for the same question in the same scope rather than adding a
// near-duplicate.
export async function teachAnswer(params: {
  teamId: string;
  dealId: string | null;
  question: string;
  answer: string;
  userId: string | null;
  meetingId?: string | null;
}): Promise<Entry> {
  const question = params.question.trim().slice(0, 500);
  const answer = params.answer.trim().slice(0, 2000);
  const q = words(question);
  const existing = (await entriesFor(params.teamId, params.dealId)).find(
    (r) => (r.dealId ?? null) === (params.dealId ?? null) && overlap(q, words(r.question)) >= SAME_QUESTION
  );
  forget(params.teamId);
  if (existing) {
    const [row] = await db
      .update(answerPlaybook)
      .set({ question, answer, source: "taught", userId: params.userId, updatedAt: new Date() })
      .where(eq(answerPlaybook.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(answerPlaybook)
    .values({
      teamId: params.teamId,
      dealId: params.dealId,
      question,
      answer,
      source: "taught",
      userId: params.userId,
      meetingId: params.meetingId ?? null,
    })
    .returning();
  return row;
}

export function invalidatePlaybook(teamId: string) {
  forget(teamId);
}

// ---- Learning from each call ----------------------------------------

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const TRANSCRIPT_CHARS = 60_000;
const MAX_LEARNED_PER_CALL = 10;

const LEARN_TOOL = {
  name: "record_learned_answers",
  description: "Record the reusable answers the seller's side gave to the client's questions on this call.",
  input_schema: {
    type: "object" as const,
    properties: {
      answers: {
        type: "array",
        description: `Up to ${MAX_LEARNED_PER_CALL}. Empty if nothing reusable was answered.`,
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The client's question, as one clear general line." },
            answer: {
              type: "string",
              description:
                "What the seller's side actually answered, condensed to 1-3 sentences in their own words and tone — keep their numbers, names and phrasing. Never add anything they didn't say.",
            },
            dealSpecific: {
              type: "boolean",
              description: "True if the answer only holds for this client (their price, their dates, their setup); false if the team would answer any client this way.",
            },
            replaces: {
              type: ["integer", "null"],
              description: "The number of an existing playbook entry this is the same question as, when this call's answer is newer or better. Otherwise null.",
            },
          },
          required: ["question", "answer", "dealSpecific", "replaces"],
        },
      },
    },
    required: ["answers"],
  },
};

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  return new Anthropic({ apiKey, fetch: meteredFetch("playbook_learning") });
}

// Called once a meeting is written up. Best-effort: never throws.
export async function learnFromCall(meetingId: string, utterances: Utterance[]): Promise<number> {
  try {
    const [row] = await db
      .select({ meeting: meetings, ownerName: users.name, ownerTeamId: users.teamId })
      .from(meetings)
      .leftJoin(users, eq(users.id, meetings.userId))
      .where(eq(meetings.id, meetingId));
    if (!row || utterances.length < 6) return 0;
    const { meeting } = row;
    const [deal] = meeting.dealId ? await db.select().from(deals).where(eq(deals.id, meeting.dealId)) : [];
    const teamId = deal?.teamId ?? row.ownerTeamId;
    if (!teamId) return 0;

    const existing = await entriesFor(teamId, deal?.id ?? null);
    const shortlist = existing.slice(0, 60);
    const asked = (meeting.liveQuestions ?? []) as LiveQuestionRecord[];
    const transcript = utterances
      .map((u) => `${u.speakerLabel}: ${u.text}`)
      .join("\n")
      .slice(-TRANSCRIPT_CHARS);

    const message = await withAiUser({ userId: meeting.userId, meetingId }, () =>
      createWithForcedTool(client(), {
        model: MODEL,
        max_tokens: 3000,
        system:
          "You build a sales team's answer playbook from their real calls: for each question the client asked that the seller's side actually answered, keep that answer — the team's own words, numbers and tone — so it can be reused on the next call. Only answers the seller's side really gave on this call; skip small talk, questions they deferred (\"I'll get back to you\") or didn't answer, and the seller's own discovery questions. Never invent or improve on what was said.",
        tools: [LEARN_TOOL],
        tool_choice: { type: "tool", name: LEARN_TOOL.name },
        messages: [
          {
            role: "user",
            content: `Call: ${meeting.title}${deal ? ` (deal: ${deal.name})` : ""}. The seller's side includes ${row.ownerName || "the meeting owner"}; the transcript may come from live speech-to-text, so read through misheard words.\n\nAnswers Anchor suggested during the call${
              asked.length ? "" : ": none"
            }${asked
              .map(
                (q) =>
                  `\n- Q: ${q.question}\n  Anchor suggested: ${q.answer}${q.feedback ? ` (rated ${q.feedback}${q.correction ? `, should have been: ${q.correction}` : ""})` : ""}`
              )
              .join("")}\n\nWhat's already in the playbook${shortlist.length ? "" : ": nothing yet"}${shortlist
              .map((e, i) => `\n${i + 1}. Q: ${e.question}\n   A: ${e.answer}`)
              .join("")}\n\nTranscript:\n${transcript}`,
          },
        ],
      })
    );
    const tool = message.content.find((b) => b.type === "tool_use");
    const raw = tool && tool.type === "tool_use" ? (tool.input as { answers?: unknown }).answers : null;
    if (!Array.isArray(raw)) return 0;

    let saved = 0;
    for (const a of raw.slice(0, MAX_LEARNED_PER_CALL)) {
      const question = typeof a?.question === "string" ? a.question.trim().slice(0, 500) : "";
      const answer = typeof a?.answer === "string" ? a.answer.trim().slice(0, 2000) : "";
      if (!question || !answer) continue;
      const dealId = a.dealSpecific === true && deal ? deal.id : null;
      const target = Number.isInteger(a.replaces) ? shortlist[a.replaces - 1] : undefined;
      if (target) {
        // A person's own answer always wins over one learned from a call.
        if (target.source === "taught") continue;
        await db
          .update(answerPlaybook)
          .set({ question, answer, meetingId, updatedAt: new Date() })
          .where(eq(answerPlaybook.id, target.id));
      } else {
        await db.insert(answerPlaybook).values({ teamId, dealId, question, answer, source: "call", meetingId, userId: meeting.userId });
      }
      saved++;
    }
    forget(teamId);
    if (saved) console.log(`[answerPlaybook] learned ${saved} answer(s) from ${meetingId}`);
    return saved;
  } catch (err) {
    console.error(`[answerPlaybook] learning from ${meetingId} failed:`, err);
    return 0;
  }
}

// Entries a person can see on the Playbook page: the team's, minus deals
// they can't open.
export async function playbookForTeam(teamId: string, visibleDealIds: string[] | "all") {
  const rows = await db
    .select({ entry: answerPlaybook, dealName: deals.name })
    .from(answerPlaybook)
    .leftJoin(deals, eq(deals.id, answerPlaybook.dealId))
    .where(
      and(
        eq(answerPlaybook.teamId, teamId),
        visibleDealIds === "all"
          ? undefined
          : or(isNull(answerPlaybook.dealId), visibleDealIds.length ? inArray(answerPlaybook.dealId, visibleDealIds) : undefined)
      )
    )
    .orderBy(desc(answerPlaybook.updatedAt))
    .limit(MAX_ENTRIES);
  return rows;
}
